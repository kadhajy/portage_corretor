"""Aplicação de correção da avaliação do desenvolvimento infantil (Guia Portage).

O foco desta implementação está nos cálculos:
  - idade do paciente em meses de vida;
  - decisão de quais habilidades de cada área aparecem para o usuário;
  - somatório das habilidades marcadas como "realiza";
  - idade de desenvolvimento estimada por área (ver `idade_desenvolvimento`).
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import math
import re
import unicodedata
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches
from flask import Flask, jsonify, render_template, request, send_file

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "portage.json"

# Idade máxima avaliável: 6 anos completos = 72 meses de vida.
MAX_MESES = 72

# --- Cálculo da idade de desenvolvimento -----------------------------------
# Baseado em tabela_calculo_portage.xlsx (linha 10 da Planilha1). Para cada
# área o resultado, em anos, é:
#
#   ROUND( soma_faixas( (pontos_faixa * 12 / divisor_faixa) / 12 ) , 0)
#
# onde `pontos_faixa` é a quantidade de habilidades marcadas como "realiza"
# naquela faixa etária e `divisor_faixa` é o total de habilidades da faixa
# segundo o Guia Portage. O resultado é limitado a 6 anos.
FAIXAS = [
    "0 a 1 ano",
    "1 a 2 anos",
    "2 a 3 anos",
    "3 a 4 anos",
    "4 a 5 anos",
    "5 a 6 anos",
]

DIVISORES_IDADE_DESENV = {
    "socializacao": [28, 16, 8, 12, 9, 11],
    "linguagem": [10, 18, 30, 24, 15, 14],
    "cognicao": [14, 10, 16, 24, 22, 22],
    "autocuidados": [13, 12, 27, 15, 23, 15],
    "des_mot": [45, 18, 17, 15, 16, 29],
}

IDADE_DESENV_MAX_ANOS = 6

app = Flask(__name__)


def carregar_dados() -> dict:
    with DATA_FILE.open(encoding="utf-8") as fp:
        return json.load(fp)


PORTAGE = carregar_dados()


def parse_data(valor: str) -> date:
    """Converte uma string ISO (YYYY-MM-DD) vinda do input HTML em date."""
    return date.fromisoformat(valor)


def meses_de_vida(nascimento: date, referencia: date) -> int:
    """Retorna quantos meses de vida completos o paciente tem na data de referência.

    O cálculo considera ano e mês e desconta um mês quando o dia da data de
    referência ainda não alcançou o dia do nascimento.
    """
    meses = (referencia.year - nascimento.year) * 12 + (referencia.month - nascimento.month)
    if referencia.day < nascimento.day:
        meses -= 1
    return meses


def faixa_indice(range_i: int) -> int:
    """Converte o range_i (em meses) no índice da faixa etária (0 a 5)."""
    return max(0, min(len(FAIXAS) - 1, int(range_i) // 12))


def filtrar_areas(meses: int) -> list[dict]:
    """Monta as áreas com apenas as habilidades cujo range_i <= meses de vida."""
    areas = []
    for area in PORTAGE["areas"]:
        habilidades = [
            {
                "item": item["item"],
                "habilidade": item["habilidade"],
                "range_i": item["range_i"],
                "faixa": faixa_indice(item["range_i"]),
            }
            for item in area["items"]
            if item["habilidade"] and meses >= item["range_i"]
        ]
        areas.append(
            {
                "key": area["key"],
                "label": area["label"],
                "habilidades": habilidades,
                "total_habilidades": len(habilidades),
            }
        )
    return areas


def idade_desenvolvimento(pontos_por_faixa: list[float], divisores: list[int]) -> dict:
    """Idade de desenvolvimento (em anos) de uma área, conforme a planilha.

    `pontos_por_faixa` tem um valor por faixa etária (0 a 1 ano, 1 a 2 anos, ...)
    com a quantidade de habilidades marcadas como "realiza" naquela faixa.
    """
    bruto = 0.0
    for pontos, divisor in zip(pontos_por_faixa, divisores):
        if divisor:
            bruto += (float(pontos) * 12 / divisor) / 12

    # Excel ROUND arredonda 0,5 para cima; os valores aqui são sempre >= 0.
    anos = int(math.floor(bruto + 0.5))
    anos = min(anos, IDADE_DESENV_MAX_ANOS)
    return {"valor_bruto": round(bruto, 4), "anos": anos}


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/avaliacao")
def avaliacao():
    payload = request.get_json(silent=True) or {}

    nome = (payload.get("nome") or "").strip()
    nascimento_raw = payload.get("data_nascimento") or ""
    modo = payload.get("modo") or "hoje"  # "hoje" ou "data_limite"
    data_limite_raw = payload.get("data_limite") or ""

    if not nome:
        return jsonify({"erro": "Informe o nome do paciente."}), 400
    try:
        nascimento = parse_data(nascimento_raw)
    except ValueError:
        return jsonify({"erro": "Data de nascimento inválida."}), 400

    if modo == "data_limite":
        try:
            referencia = parse_data(data_limite_raw)
        except ValueError:
            return jsonify({"erro": "Data limite inválida."}), 400
    else:
        referencia = date.today()

    if referencia < nascimento:
        return jsonify({"erro": "A data de referência é anterior à data de nascimento."}), 400

    meses = meses_de_vida(nascimento, referencia)
    avaliavel = meses < MAX_MESES

    resposta = {
        "nome": nome,
        "data_nascimento": nascimento.isoformat(),
        "modo": modo,
        "data_referencia": referencia.isoformat(),
        "meses_de_vida": meses,
        "anos": meses // 12,
        "meses_restantes": meses % 12,
        "idade_maxima_meses": MAX_MESES,
        "avaliavel": avaliavel,
    }

    if avaliavel:
        resposta["areas"] = filtrar_areas(meses)
    else:
        resposta["mensagem"] = (
            "A idade máxima para avaliar um paciente é de 6 anos (72 meses de vida). "
            "Este paciente já não pode mais ser avaliado. "
            "Você pode informar uma data limite para que os meses de vida se enquadrem no aceitável."
        )

    return jsonify(resposta)


@app.post("/api/resultado")
def resultado():
    """Recebe os pontos marcados por área/faixa e devolve a idade de desenvolvimento."""
    payload = request.get_json(silent=True) or {}
    pontos = payload.get("pontos") or {}

    areas = []
    for area in PORTAGE["areas"]:
        key = area["key"]
        divisores = DIVISORES_IDADE_DESENV.get(key)
        if not divisores:
            continue

        brutos = pontos.get(key) or []
        por_faixa = [float(brutos[i]) if i < len(brutos) and brutos[i] is not None else 0.0
                     for i in range(len(FAIXAS))]

        calc = idade_desenvolvimento(por_faixa, divisores)
        areas.append(
            {
                "key": key,
                "label": area["label"],
                "pontos_por_faixa": por_faixa,
                "valor_bruto": calc["valor_bruto"],
                "idade_anos": calc["anos"],
            }
        )

    return jsonify({"faixas": FAIXAS, "areas": areas})


def _formatar_data_br(iso: str) -> str:
    try:
        return date.fromisoformat(iso).strftime("%d/%m/%Y")
    except (ValueError, TypeError):
        return iso or "-"


def _nome_paciente_limpo(nome: str) -> str:
    """Nome sem acentos nem caracteres especiais, mantendo os espaços."""
    nome = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode("ascii")
    nome = re.sub(r"[^A-Za-z0-9 ]", "", nome)
    nome = re.sub(r"\s+", " ", nome).strip()
    return nome or "paciente"


def _nome_arquivo_saida(paciente: dict, extensao: str) -> str:
    """Padrão: ava_<nome do paciente>_<yyyymmdd>.<extensao>.

    A data é a data limite informada pelo usuário (quando esse modo foi usado)
    ou a data atual de geração do arquivo.
    """
    ref = paciente.get("data_referencia") or ""
    if paciente.get("modo") == "data_limite" and ref:
        data = ref.replace("-", "")
    else:
        data = date.today().strftime("%Y%m%d")
    return f"ava_{_nome_paciente_limpo(paciente.get('nome'))}_{data}.{extensao}"


def _calcular_area(area: dict) -> dict:
    """Recebe uma área com habilidades marcadas e devolve os números do relatório."""
    key = area.get("key")
    habilidades = area.get("habilidades") or []
    pontos = sum(1 for h in habilidades if h.get("realiza"))

    por_faixa = [0.0] * len(FAIXAS)
    for h in habilidades:
        if h.get("realiza"):
            fi = int(h.get("faixa") or 0)
            if 0 <= fi < len(FAIXAS):
                por_faixa[fi] += 1

    divisores = DIVISORES_IDADE_DESENV.get(key)
    idade = idade_desenvolvimento(por_faixa, divisores)["anos"] if divisores else None

    return {
        "key": key,
        "label": area.get("label") or key,
        "habilidades": habilidades,
        "pontos": pontos,
        "maximo": len(habilidades),
        "idade_anos": idade,
    }


def _montar_docx(tipo: str, paciente: dict, areas: list[dict], grafico_b64: str) -> io.BytesIO:
    doc = Document()

    doc.add_heading("Relatório de Avaliação do Desenvolvimento Infantil", level=0)
    doc.add_paragraph().add_run("Baseado no Guia Portage").italic = True

    doc.add_heading("Dados do paciente", level=1)
    nome = paciente.get("nome") or "-"
    data_ref = _formatar_data_br(paciente.get("data_referencia"))
    if paciente.get("modo") == "data_limite":
        data_ref += " (data limite)"
    linhas_paciente = [
        f"Nome: {nome}",
        f"Data de nascimento: {_formatar_data_br(paciente.get('data_nascimento'))}",
        f"Data de referência: {data_ref}",
        f"Idade: {paciente.get('anos', 0)} ano(s) e {paciente.get('meses_restantes', 0)} "
        f"mês(es) — {paciente.get('meses_de_vida', 0)} meses de vida",
        f"Relatório gerado em: {date.today().strftime('%d/%m/%Y')}",
    ]
    for texto in linhas_paciente:
        doc.add_paragraph(texto, style="List Bullet")

    # Tabela 1 - somatório de pontos por seção
    doc.add_heading("Somatório de pontos por seção", level=1)
    t1 = doc.add_table(rows=1, cols=3)
    t1.style = "Table Grid"
    for i, titulo in enumerate(("Seção", "Pontos", "Máximo de pontos")):
        t1.rows[0].cells[i].text = titulo
    total_pontos = total_maximo = 0
    for area in areas:
        total_pontos += area["pontos"]
        total_maximo += area["maximo"]
        c = t1.add_row().cells
        c[0].text = area["label"]
        c[1].text = str(area["pontos"])
        c[2].text = str(area["maximo"])
    c = t1.add_row().cells
    c[0].text = "Total geral"
    c[1].text = str(total_pontos)
    c[2].text = str(total_maximo)

    # Tabela 2 - idade de desenvolvimento estimada
    doc.add_heading("Idade de desenvolvimento estimada", level=1)
    doc.add_paragraph(
        "Cálculo baseado na planilha de referência do Guia Portage (limite de 6 anos). "
        "É apenas um guia e não substitui a avaliação de um profissional qualificado."
    )
    t2 = doc.add_table(rows=1, cols=2)
    t2.style = "Table Grid"
    t2.rows[0].cells[0].text = "Seção"
    t2.rows[0].cells[1].text = "Idade de desenvolvimento"
    for area in areas:
        c = t2.add_row().cells
        c[0].text = area["label"]
        anos = area["idade_anos"]
        c[1].text = "-" if anos is None else f"{anos} ano{'' if anos == 1 else 's'}"

    # Gráfico
    if grafico_b64:
        try:
            dados_img = grafico_b64.split(",", 1)[-1]
            doc.add_heading("Idade de desenvolvimento (gráfico)", level=1)
            doc.add_picture(io.BytesIO(base64.b64decode(dados_img)), width=Inches(6))
        except (ValueError, binascii.Error):
            pass

    # Completo: lista de habilidades avaliadas com a marcação
    if tipo == "completo":
        doc.add_page_break()
        doc.add_heading("Habilidades avaliadas", level=1)
        for area in areas:
            doc.add_heading(area["label"], level=2)
            habilidades = area["habilidades"]
            if not habilidades:
                doc.add_paragraph("Nenhuma habilidade se aplica a esta idade.")
                continue
            tab = doc.add_table(rows=1, cols=3)
            tab.style = "Table Grid"
            for i, titulo in enumerate(("Item", "Habilidade", "Realiza")):
                tab.rows[0].cells[i].text = titulo
            for h in habilidades:
                c = tab.add_row().cells
                c[0].text = str(h.get("item") or "")
                c[1].text = h.get("habilidade") or ""
                c[2].text = "Sim" if h.get("realiza") else "Não"

    # Campo de assinatura do profissional responsável
    doc.add_paragraph()
    doc.add_paragraph()
    assinatura = doc.add_paragraph("_" * 45)
    assinatura.alignment = WD_ALIGN_PARAGRAPH.CENTER
    legenda = doc.add_paragraph("Profissional")
    legenda.alignment = WD_ALIGN_PARAGRAPH.CENTER

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer


@app.post("/api/relatorio")
def relatorio():
    payload = request.get_json(silent=True) or {}
    tipo = payload.get("tipo") if payload.get("tipo") in ("resumido", "completo") else "resumido"
    paciente = payload.get("paciente") or {}
    areas_in = payload.get("areas") or []
    grafico_b64 = payload.get("grafico") or ""

    areas = [_calcular_area(area) for area in areas_in]
    buffer = _montar_docx(tipo, paciente, areas, grafico_b64)

    nome_arquivo = _nome_arquivo_saida(paciente, "docx")
    return send_file(
        buffer,
        as_attachment=True,
        download_name=nome_arquivo,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


if __name__ == "__main__":
    app.run(debug=True)
