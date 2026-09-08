"use strict";

const form = document.getElementById("form-paciente");
const wrapperDataLimite = document.getElementById("wrapper-data-limite");
const inputDataLimite = document.getElementById("data_limite");
const alerta = document.getElementById("alerta");
const resumo = document.getElementById("resumo");
const paineis = document.getElementById("paineis");
const tabelaResumo = document.getElementById("tabela-resumo");
const tabelaResumoCorpo = document.getElementById("tabela-resumo-corpo");
const tabelaResumoTotal = document.getElementById("tabela-resumo-total");
const tabelaResumoTotalMaximo = document.getElementById("tabela-resumo-total-maximo");
const tabelaIdade = document.getElementById("tabela-idade");
const tabelaIdadeCorpo = document.getElementById("tabela-idade-corpo");
const tabelaIdadePaciente = document.getElementById("tabela-idade-paciente");
const graficoCanvas = document.getElementById("grafico-idade");
const graficoWrapper = document.getElementById("grafico-idade-wrapper");
const btnRelatorioResumido = document.getElementById("btn-relatorio-resumido");
const btnRelatorioCompleto = document.getElementById("btn-relatorio-completo");
const btnSalvarProgresso = document.getElementById("btn-salvar-progresso");
const btnRestaurarProgresso = document.getElementById("btn-restaurar-progresso");
const inputRestaurarProgresso = document.getElementById("input-restaurar-progresso");
const acoesStatus = document.getElementById("acoes-status");

const PROGRESSO_APP_ID = "portage-avaliacao";
const PROGRESSO_VERSAO = 1;

const NUM_FAIXAS = 6;
const IDADE_MAX_ANOS = 6;
// Cores das barras por área, no mesmo esquema da planilha de referência.
const CORES_AREAS = ["#5B9BD5", "#ED7D31", "#A5A5A5", "#FFC000", "#70AD47"];

// ---------------------------------------------------------------------------
// MODO_TESTE: habilita os botões "Marcar/Desmarcar todas" em cada seção.
// REMOVER na versão final (definir como false já basta para escondê-los).
const MODO_TESTE = true;
// ---------------------------------------------------------------------------

let calculoIdadeTimer = null;
let ultimaAvaliacao = null;
let graficoIdade = null;

// Mostra/esconde o campo de data limite conforme o modo escolhido.
form.querySelectorAll('input[name="modo"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const usaLimite = form.querySelector('input[name="modo"]:checked').value === "data_limite";
    wrapperDataLimite.hidden = !usaLimite;
    inputDataLimite.required = usaLimite;
  });
});

function mostrarAlerta(mensagem, tipo = "warning") {
  alerta.textContent = mensagem;
  alerta.className = `alert alert-${tipo}`;
  alerta.hidden = false;
}

function limparAlerta() {
  alerta.hidden = true;
}

function formatarData(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  limparAlerta();

  const corpo = {
    nome: document.getElementById("nome").value,
    data_nascimento: document.getElementById("data_nascimento").value,
    modo: form.querySelector('input[name="modo"]:checked').value,
    data_limite: inputDataLimite.value,
  };

  let resposta;
  try {
    const req = await fetch("/api/avaliacao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    resposta = await req.json();
    if (!req.ok) {
      throw new Error(resposta.erro || "Não foi possível carregar a avaliação.");
    }
  } catch (erro) {
    resumo.hidden = true;
    paineis.innerHTML = "";
    tabelaResumo.hidden = true;
    tabelaIdade.hidden = true;
    ultimaAvaliacao = null;
    setAcoesHabilitadas();
    mostrarAlerta(erro.message, "danger");
    return;
  }

  renderizar(resposta);
});

// Habilita "Salvar progresso" e os relatórios apenas quando há uma
// avaliação carregada e o paciente pode ser avaliado.
function setAcoesHabilitadas() {
  const ok = Boolean(ultimaAvaliacao && ultimaAvaliacao.avaliavel);
  btnSalvarProgresso.disabled = !ok;
  btnRelatorioResumido.disabled = !ok;
  btnRelatorioCompleto.disabled = !ok;
}

function renderizar(dados) {
  ultimaAvaliacao = dados;
  paineis.innerHTML = "";
  tabelaResumoCorpo.innerHTML = "";
  tabelaResumo.hidden = true;
  tabelaIdadeCorpo.innerHTML = "";
  tabelaIdade.hidden = true;
  tabelaIdadePaciente.textContent = "";
  if (graficoIdade) {
    graficoIdade.destroy();
    graficoIdade = null;
  }

  document.getElementById("resumo-nome").textContent = dados.nome;
  document.getElementById("resumo-idade").textContent =
    `Meses de vida: ${dados.meses_de_vida} ` +
    `(${dados.anos} ano(s) e ${dados.meses_restantes} mês(es))`;
  document.getElementById("resumo-referencia").textContent =
    `Data de referência: ${formatarData(dados.data_referencia)} ` +
    `(${dados.modo === "data_limite" ? "data limite informada" : "data de hoje"})`;
  resumo.hidden = false;

  tabelaIdadePaciente.textContent =
    `Paciente: ${dados.nome} — idade atual: ` +
    `${dados.anos} ano(s) e ${dados.meses_restantes} mês(es) ` +
    `(${dados.meses_de_vida} meses de vida)`;

  const totalGeralEl = document.getElementById("resumo-total-geral");

  if (!dados.avaliavel) {
    totalGeralEl.textContent = "";
    setAcoesHabilitadas();
    mostrarAlerta(dados.mensagem, "warning");
    return;
  }

  totalGeralEl.textContent = "Total geral de habilidades marcadas: 0";

  dados.areas.forEach((area) => {
    paineis.appendChild(criarPainel(area, totalGeralEl));
    tabelaResumoCorpo.appendChild(criarLinhaTabela(area));
  });

  tabelaResumo.hidden = false;
  setAcoesHabilitadas();
  atualizarTotalGeral(totalGeralEl);
  atualizarTabelaResumo();
  calcularIdadeDesenvolvimento();
}

function criarPainel(area, totalGeralEl) {
  const card = document.createElement("div");
  card.className = "card shadow-sm mb-3";
  card.dataset.area = area.key;
  card.dataset.label = area.label;

  const idCollapse = `collapse-${area.key}`;

  const header = document.createElement("div");
  header.className = "card-header d-flex justify-content-between align-items-center gap-2";
  header.innerHTML = `
    <span class="fw-semibold">${area.label}</span>
    <div class="d-flex align-items-center gap-2">
      <span class="badge text-bg-primary painel-total">
        Realiza: <span class="painel-soma">0</span> / ${area.total_habilidades}
      </span>
      <button class="btn btn-sm btn-outline-secondary btn-colapse" type="button"
              data-bs-toggle="collapse" data-bs-target="#${idCollapse}"
              aria-expanded="true" aria-controls="${idCollapse}">
        Ocultar
      </button>
    </div>`;

  const collapse = document.createElement("div");
  collapse.className = "collapse show";
  collapse.id = idCollapse;

  const body = document.createElement("div");
  body.className = "card-body";

  if (area.habilidades.length === 0) {
    body.innerHTML = `<p class="text-secondary mb-0">Nenhuma habilidade se aplica a esta idade.</p>`;
  } else {
    area.habilidades.forEach((hab) => {
      body.appendChild(criarLinhaHabilidade(area.key, hab, card, totalGeralEl));
    });
  }

  const footer = document.createElement("div");
  footer.className = "card-footer text-end fw-semibold painel-total";
  footer.innerHTML =
    `Total desta seção: <span class="painel-soma-rodape">0</span> de ${area.total_habilidades}`;

  collapse.appendChild(body);
  collapse.appendChild(footer);
  card.appendChild(header);
  card.appendChild(collapse);

  // Alterna o rótulo do botão de colapso conforme o estado.
  const botao = header.querySelector(".btn-colapse");
  collapse.addEventListener("hidden.bs.collapse", () => (botao.textContent = "Mostrar"));
  collapse.addEventListener("shown.bs.collapse", () => (botao.textContent = "Ocultar"));

  // --- MODO_TESTE: botão para marcar/desmarcar todas. REMOVER na versão final. ---
  if (MODO_TESTE) {
    const btnTeste = document.createElement("button");
    btnTeste.type = "button";
    btnTeste.className = "btn btn-sm btn-outline-danger test-only";
    btnTeste.textContent = "Marcar todas";
    btnTeste.addEventListener("click", () => {
      const marcar = btnTeste.textContent === "Marcar todas";
      card.querySelectorAll(".realiza-check").forEach((c) => (c.checked = marcar));
      btnTeste.textContent = marcar ? "Desmarcar todas" : "Marcar todas";
      atualizarSomaPainel(card);
      atualizarTotalGeral(totalGeralEl);
      atualizarTabelaResumo();
      agendarCalculoIdade();
    });
    header.querySelector("div").prepend(btnTeste);
  }
  // --- fim MODO_TESTE ---

  return card;
}

function criarLinhaHabilidade(areaKey, hab, card, totalGeralEl) {
  const row = document.createElement("div");
  row.className = "habilidade-row d-flex align-items-start gap-2";

  const idCheck = `chk-${areaKey}-${hab.item}`;
  row.innerHTML = `
    <label class="flex-grow-1" for="${idCheck}">
      <span class="habilidade-item-num">${hab.item}.</span>${hab.habilidade}
    </label>
    <div class="form-check mt-1 ps-0 ms-2">
      <input class="form-check-input realiza-check ms-0" type="checkbox"
             id="${idCheck}" data-faixa="${hab.faixa}">
    </div>`;

  row.querySelector(".realiza-check").addEventListener("change", () => {
    atualizarSomaPainel(card);
    atualizarTotalGeral(totalGeralEl);
    atualizarTabelaResumo();
    agendarCalculoIdade();
  });

  return row;
}

function criarLinhaTabela(area) {
  const tr = document.createElement("tr");
  tr.dataset.area = area.key;
  tr.innerHTML = `
    <td>${area.label}</td>
    <td class="text-end painel-total"><span class="tabela-pontos">0</span></td>
    <td class="text-end tabela-maximo">${area.total_habilidades}</td>`;
  return tr;
}

function somaMarcados(card) {
  return card.querySelectorAll(".realiza-check:checked").length;
}

function atualizarSomaPainel(card) {
  const marcados = somaMarcados(card);
  card.querySelector(".painel-soma").textContent = marcados;
  card.querySelector(".painel-soma-rodape").textContent = marcados;
}

function atualizarTotalGeral(totalGeralEl) {
  const total = document.querySelectorAll("#paineis .realiza-check:checked").length;
  totalGeralEl.textContent = `Total geral de habilidades marcadas: ${total}`;
}

function atualizarTabelaResumo() {
  let totalPontos = 0;
  let totalMaximo = 0;

  paineis.querySelectorAll(".card").forEach((card) => {
    const pontos = somaMarcados(card);
    totalPontos += pontos;

    const linha = tabelaResumoCorpo.querySelector(`tr[data-area="${card.dataset.area}"]`);
    if (linha) {
      linha.querySelector(".tabela-pontos").textContent = pontos;
      totalMaximo += Number(linha.querySelector(".tabela-maximo").textContent) || 0;
    }
  });

  tabelaResumoTotal.textContent = totalPontos;
  tabelaResumoTotalMaximo.textContent = totalMaximo;
}

// --- Idade de desenvolvimento --------------------------------------------

// Conta as habilidades marcadas por área e por faixa etária (índice 0 a 5).
function coletarPontosPorFaixa() {
  const pontos = {};
  paineis.querySelectorAll(".card").forEach((card) => {
    const faixas = new Array(NUM_FAIXAS).fill(0);
    card.querySelectorAll(".realiza-check:checked").forEach((check) => {
      const faixa = Number(check.dataset.faixa);
      if (faixa >= 0 && faixa < NUM_FAIXAS) faixas[faixa] += 1;
    });
    pontos[card.dataset.area] = faixas;
  });
  return pontos;
}

// Evita disparar uma requisição a cada clique em sequência.
function agendarCalculoIdade() {
  clearTimeout(calculoIdadeTimer);
  calculoIdadeTimer = setTimeout(calcularIdadeDesenvolvimento, 200);
}

async function calcularIdadeDesenvolvimento() {
  const pontos = coletarPontosPorFaixa();
  try {
    const req = await fetch("/api/resultado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pontos }),
    });
    const dados = await req.json();
    if (!req.ok) throw new Error(dados.erro || "Falha ao calcular a idade de desenvolvimento.");
    renderTabelaIdade(dados);
  } catch (erro) {
    tabelaIdade.hidden = true;
    console.error(erro);
  }
}

function renderTabelaIdade(dados) {
  tabelaIdadeCorpo.innerHTML = "";
  dados.areas.forEach((area) => {
    const anos = area.idade_anos;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${area.label}</td>
      <td class="text-end fw-semibold">${anos} ano${anos === 1 ? "" : "s"}</td>`;
    tabelaIdadeCorpo.appendChild(tr);
  });
  tabelaIdade.hidden = dados.areas.length === 0;
  if (!tabelaIdade.hidden) renderGraficoIdade(dados);
}

// Fundo branco no canvas para o gráfico exportado no relatório .docx.
const fundoBrancoPlugin = {
  id: "fundoBranco",
  beforeDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

// Rótulo com o valor (1 casa) acima das barras de "Idade de desenvolvimento".
const rotuloValoresPlugin = {
  id: "rotuloValores",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || meta.hidden) return;
    ctx.save();
    ctx.font = "600 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    meta.data.forEach((barra, i) => {
      const valor = chart.data.datasets[0].data[i];
      if (valor == null) return;
      ctx.fillText(Number(valor).toFixed(1), barra.x, barra.y - 4);
    });
    ctx.restore();
  },
};

// Gráfico de colunas no mesmo molde de tabela_calculo_portage.xlsx:
// uma barra de "idade de desenvolvimento" por área + a idade atual do
// paciente como referência; eixo Y de 0 a 6 anos.
function renderGraficoIdade(dados) {
  if (typeof Chart === "undefined" || !graficoCanvas) return;

  const labels = dados.areas.map((a) => a.label);
  const desenvolvimento = dados.areas.map((a) => Math.round(a.valor_bruto * 10) / 10);

  const idadeAtualAnos = ultimaAvaliacao
    ? Math.min(IDADE_MAX_ANOS, Math.round((ultimaAvaliacao.meses_de_vida / 12) * 10) / 10)
    : 0;
  const idadeAtualSerie = labels.map(() => idadeAtualAnos);

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Idade de desenvolvimento",
          data: desenvolvimento,
          backgroundColor: labels.map((_, i) => CORES_AREAS[i % CORES_AREAS.length]),
        },
        {
          label: "Idade atual do paciente",
          data: idadeAtualSerie,
          backgroundColor: "#ED7D31",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: IDADE_MAX_ANOS,
          ticks: { stepSize: 1 },
          title: { display: true, text: "Anos" },
          grid: { color: "#B7B7B7" },
        },
      },
      plugins: {
        title: { display: true, text: "Idade de desenvolvimento", color: "#757575", font: { size: 16 } },
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} ano(s)`,
          },
        },
      },
    },
    plugins: [fundoBrancoPlugin, rotuloValoresPlugin],
  };

  if (graficoIdade) graficoIdade.destroy();
  graficoIdade = new Chart(graficoCanvas, config);
  if (graficoWrapper) graficoWrapper.hidden = false;
}

// --- Relatório (.docx) --------------------------------------------------

// Reúne as áreas com a marcação atual de cada habilidade (checkbox "realiza").
function coletarAreasComMarcacao() {
  if (!ultimaAvaliacao || !ultimaAvaliacao.areas) return [];
  return ultimaAvaliacao.areas.map((area) => ({
    key: area.key,
    label: area.label,
    habilidades: area.habilidades.map((h) => {
      const check = document.getElementById(`chk-${area.key}-${h.item}`);
      return {
        item: h.item,
        habilidade: h.habilidade,
        faixa: h.faixa,
        realiza: Boolean(check && check.checked),
      };
    }),
  }));
}

async function gerarRelatorio(tipo) {
  if (!ultimaAvaliacao || !ultimaAvaliacao.avaliavel) return;

  const payload = {
    tipo,
    paciente: {
      nome: ultimaAvaliacao.nome,
      data_nascimento: ultimaAvaliacao.data_nascimento,
      data_referencia: ultimaAvaliacao.data_referencia,
      modo: ultimaAvaliacao.modo,
      meses_de_vida: ultimaAvaliacao.meses_de_vida,
      anos: ultimaAvaliacao.anos,
      meses_restantes: ultimaAvaliacao.meses_restantes,
    },
    areas: coletarAreasComMarcacao(),
    grafico: graficoIdade ? graficoIdade.toBase64Image("image/png", 1) : "",
  };

  btnRelatorioResumido.disabled = true;
  btnRelatorioCompleto.disabled = true;
  acoesStatus.textContent = "Gerando relatório...";

  try {
    const req = await fetch("/api/relatorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!req.ok) throw new Error("Falha ao gerar o relatório.");

    const blob = await req.blob();
    baixarArquivo(blob, nomeArquivoSaida("docx"));
    acoesStatus.textContent = "Relatório gerado.";
  } catch (erro) {
    console.error(erro);
    acoesStatus.textContent = erro.message;
  } finally {
    setAcoesHabilitadas();
  }
}

btnRelatorioResumido.addEventListener("click", () => gerarRelatorio("resumido"));
btnRelatorioCompleto.addEventListener("click", () => gerarRelatorio("completo"));

// --- Salvar / restaurar progresso -------------------------------------

// Nome do paciente sem acentos nem caracteres especiais, mantendo os espaços.
function nomePacienteLimpo(nome) {
  return (
    (nome || "paciente")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "paciente"
  );
}

// Data do arquivo em yyyymmdd: a data limite informada pelo usuário quando
// esse modo foi usado, senão a data atual da geração do arquivo.
function dataArquivo() {
  if (ultimaAvaliacao && ultimaAvaliacao.modo === "data_limite" && ultimaAvaliacao.data_referencia) {
    return ultimaAvaliacao.data_referencia.replace(/-/g, "");
  }
  const hoje = new Date();
  const mm = String(hoje.getMonth() + 1).padStart(2, "0");
  const dd = String(hoje.getDate()).padStart(2, "0");
  return `${hoje.getFullYear()}${mm}${dd}`;
}

// Padrão: ava_<nome do paciente>_<yyyymmdd>.<extensao>
function nomeArquivoSaida(extensao) {
  const nome = ultimaAvaliacao ? ultimaAvaliacao.nome : "";
  return `ava_${nomePacienteLimpo(nome)}_${dataArquivo()}.${extensao}`;
}

function baixarArquivo(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Marcacoes atuais: { "<area>": { "<item>": true } } - apenas as marcadas.
function coletarMarcacoes() {
  const marcacoes = {};
  paineis.querySelectorAll(".card").forEach((card) => {
    const itens = {};
    card.querySelectorAll(".realiza-check:checked").forEach((check) => {
      const item = check.id.replace(`chk-${card.dataset.area}-`, "");
      itens[item] = true;
    });
    marcacoes[card.dataset.area] = itens;
  });
  return marcacoes;
}

function salvarProgresso() {
  if (!ultimaAvaliacao || !ultimaAvaliacao.avaliavel) return;

  const estado = {
    app: PROGRESSO_APP_ID,
    versao: PROGRESSO_VERSAO,
    salvo_em: new Date().toISOString(),
    formulario: {
      nome: document.getElementById("nome").value,
      data_nascimento: document.getElementById("data_nascimento").value,
      modo: form.querySelector('input[name="modo"]:checked').value,
      data_limite: inputDataLimite.value,
    },
    avaliacao: ultimaAvaliacao,
    marcacoes: coletarMarcacoes(),
  };

  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
  baixarArquivo(blob, nomeArquivoSaida("json"));
  acoesStatus.textContent = "Progresso salvo.";
}

// Aplica as marcacoes salvas aos checkboxes ja renderizados e recalcula tudo.
function aplicarMarcacoes(marcacoes) {
  Object.entries(marcacoes || {}).forEach(([areaKey, itens]) => {
    Object.entries(itens || {}).forEach(([item, valor]) => {
      const check = document.getElementById(`chk-${areaKey}-${item}`);
      if (check) check.checked = Boolean(valor);
    });
  });

  const totalGeralEl = document.getElementById("resumo-total-geral");
  paineis.querySelectorAll(".card").forEach((card) => atualizarSomaPainel(card));
  atualizarTotalGeral(totalGeralEl);
  atualizarTabelaResumo();
  calcularIdadeDesenvolvimento();
}

async function restaurarProgresso(arquivo) {
  let estado;
  try {
    estado = JSON.parse(await arquivo.text());
  } catch {
    acoesStatus.textContent = "Arquivo invalido: nao e um JSON valido.";
    return;
  }

  if (!estado || estado.app !== PROGRESSO_APP_ID || !estado.avaliacao) {
    acoesStatus.textContent = "Arquivo nao reconhecido como progresso desta aplicacao.";
    return;
  }

  const f = estado.formulario || {};
  document.getElementById("nome").value = f.nome || "";
  document.getElementById("data_nascimento").value = f.data_nascimento || "";
  inputDataLimite.value = f.data_limite || "";
  const radio = document.getElementById(f.modo === "data_limite" ? "modo-limite" : "modo-hoje");
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  }

  limparAlerta();
  renderizar(estado.avaliacao);
  if (estado.avaliacao.avaliavel) aplicarMarcacoes(estado.marcacoes);

  const quando = (estado.salvo_em || "").replace("T", " ").slice(0, 16);
  acoesStatus.textContent = `Progresso restaurado${quando ? ` (salvo em ${quando})` : ""}.`;
}

btnSalvarProgresso.addEventListener("click", salvarProgresso);
btnRestaurarProgresso.addEventListener("click", () => inputRestaurarProgresso.click());
inputRestaurarProgresso.addEventListener("change", (evento) => {
  const arquivo = evento.target.files && evento.target.files[0];
  if (arquivo) restaurarProgresso(arquivo);
  evento.target.value = "";
});
