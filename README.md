# Avaliação do Desenvolvimento Infantil — Guia Portage

Aplicação web que apoia a correção de uma avaliação do desenvolvimento
infantil baseada no **Guia Portage**. A partir da data de nascimento do
paciente (ou de uma data limite), a aplicação decide quais habilidades de
cada área devem ser avaliadas, soma as habilidades marcadas como "realiza" e
estima a idade de desenvolvimento por área.

> Ferramenta de apoio à criação de atividades. **Não substitui a avaliação
> de um profissional qualificado** nem serve para diagnóstico.

## Funcionalidades

- Cadastro do paciente com cálculo dos **meses de vida** por data de hoje ou
  por **data limite** informada.
- Bloqueio da avaliação para pacientes com 6 anos ou mais (72 meses).
- Um painel colapsável por área avaliada: **Socialização, Linguagem,
  Cognição, Autocuidados e Desenvolvimento Motor**.
- Exibição apenas das habilidades compatíveis com a idade
  (`meses_de_vida >= range_i`), cada uma com um checkbox "realiza".
- Somatório por seção (`marcadas de total`), total geral e tabela
  "pontos por seção / máximo de pontos".
- **Idade de desenvolvimento** estimada por área, com tabela e gráfico de
  colunas (eixo de 0 a 6 anos), no mesmo molde da planilha de referência.
- **Relatórios em `.docx`** (resumido e completo) e **salvar / restaurar
  progresso** em `.json`.

## Requisitos

- Python 3.10+
- Pacotes em `requirements.txt` (`Flask`, `python-docx`, `openpyxl`,
  `pandas`)
- Acesso à internet no navegador que abre a página (Bootstrap e Chart.js são
  carregados via CDN)

## Instalação e execução

```bash
python -m venv .venv          # se ainda não existir
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py                 # http://127.0.0.1:5000
```

## Como usar

1. Preencha **nome** e **data de nascimento** do paciente.
2. Escolha como calcular os meses de vida: **data de hoje** ou **data
   limite**. Se o paciente tiver 72 meses ou mais, informe uma data limite
   para que a idade se enquadre.
3. Clique em **Carregar avaliação**. Os painéis de cada área aparecem com as
   habilidades da faixa etária.
4. Marque as habilidades que o paciente **realiza**. Os somatórios, a tabela
   de idade de desenvolvimento e o gráfico se atualizam sozinhos.
5. No card **Ações**, ao final da página:
   - **Salvar progresso (.json)** — baixa o estado atual da avaliação.
   - **Restaurar progresso** — carrega um `.json` salvo antes.
   - **Relatório resumido / completo (.docx)** — gera o documento.

Os arquivos gerados seguem o padrão:

```
ava_<nome do paciente, sem acentos, com espaços>_<yyyymmdd>.<ext>
```

onde a data é a data limite (quando usada) ou a data de geração.

## Dados da avaliação

As habilidades ficam em `data/portage.json`, gerado a partir de
`tabela_portage.xlsx` (5 planilhas, uma por área; colunas `item`,
`habilidade`, `range_i`, `range_f`, `realiza`). Linhas com `habilidade` em
branco são ignoradas.

Depois de editar a planilha, regenere o JSON e reinicie a aplicação:

```bash
python scripts/xlsx_to_json.py
```

Os divisores usados no cálculo da idade de desenvolvimento vêm de
`tabela_calculo_portage.xlsx` e estão fixos em `DIVISORES_IDADE_DESENV`
(`app.py`).

## Estrutura do projeto

```
app.py                      # servidor Flask, regras de cálculo e geração do .docx
data/portage.json           # habilidades por área (fonte de dados da aplicação)
scripts/xlsx_to_json.py     # regenera data/portage.json a partir do .xlsx
templates/index.html        # página única
static/js/app.js            # lógica de interface, chamadas à API, relatórios
static/css/style.css        # ajustes visuais
requirements.txt
tabela_portage.xlsx         # molde das habilidades por área
tabela_calculo_portage.xlsx # molde do cálculo da idade de desenvolvimento
```

## Endpoints

| Método | Rota              | Descrição                                              |
|--------|-------------------|-------------------------------------------------------|
| GET    | `/`               | Página da aplicação                                    |
| POST   | `/api/avaliacao`  | Meses de vida + habilidades filtradas por área         |
| POST   | `/api/resultado`  | Idade de desenvolvimento por área                      |
| POST   | `/api/relatorio`  | Gera o relatório `.docx` (resumido ou completo)        |

## Observações

- Os dados atuais de `tabela_portage.xlsx` não têm habilidades da faixa
  5 a 6 anos, então essa faixa contribui com 0 no cálculo da idade de
  desenvolvimento.
- `MODO_TESTE` em `static/js/app.js` adiciona botões "Marcar/Desmarcar
  todas" por seção para facilitar testes. Defina `MODO_TESTE = false` na
  versão final.
