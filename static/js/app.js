"use strict";

const form = document.getElementById("form-paciente");
const inputNome = document.getElementById("nome");
const inputDataNascimento = document.getElementById("data_nascimento");
const wrapperDataLimite = document.getElementById("wrapper-data-limite");
const inputDataLimite = document.getElementById("data_limite");
const alerta = document.getElementById("alerta");
const resumo = document.getElementById("resumo");
const paineis = document.getElementById("paineis");
const tabelaResumo = document.getElementById("tabela-resumo");
const tabelaResumoCorpo = document.getElementById("tabela-resumo-corpo");
const tabelaResumoTotal = document.getElementById("tabela-resumo-total");
const tabelaResumoTotalMaximo = document.getElementById("tabela-resumo-total-maximo");
const avisoIdade = document.getElementById("aviso-idade");
const avisoIdadeTexto = document.getElementById("aviso-idade-texto");
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
const btnResetarRespostas = document.getElementById("btn-resetar-respostas");
const acoesStatus = document.getElementById("acoes-status");

const PROGRESSO_APP_ID = "portage-avaliacao";
const PROGRESSO_VERSAO = 2;

// Pontuação de cada resposta possível de uma habilidade.
const VALOR_RESPOSTA = { sim: 1, av: 0.5, nao: 0 };
const RESPOSTA_PADRAO = "nao";

// Número em pt-BR: inteiro sem casas, fracionário com uma casa e vírgula.
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

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

// Respostas do usuário guardadas entre recarregamentos da avaliação (ex.: ao
// mudar a data limite). Formato: { "<area>": { "<item>": "sim"|"av"|"nao" } }.
// Só são zeradas pelo botão "Resetar respostas" ou ao restaurar um progresso.
let marcacoesMemoria = {};

function normalizarResposta(valor) {
  if (valor === true) return "sim";
  if (valor === false || valor == null) return "nao";
  return valor in VALOR_RESPOSTA ? valor : "nao";
}

function registrarMarcacao(areaKey, item, valor) {
  if (!marcacoesMemoria[areaKey]) marcacoesMemoria[areaKey] = {};
  marcacoesMemoria[areaKey][item] = normalizarResposta(valor);
}

// Copia para a memória o estado atual de todos os grupos já renderizados,
// sem apagar respostas de itens que não estão visíveis nesta faixa etária.
function lembrarMarcacoesRenderizadas() {
  Object.entries(coletarMarcacoes()).forEach(([areaKey, itens]) => {
    Object.entries(itens).forEach(([item, valor]) => registrarMarcacao(areaKey, item, valor));
  });
}

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

// Assinatura dos campos do formulário já carregados, para evitar recarregar
// a avaliação com os mesmos dados enquanto o usuário continua digitando.
let autoCarregarTimer = null;
let assinaturaCarregada = null;

function modoAtual() {
  return form.querySelector('input[name="modo"]:checked').value;
}

function assinaturaFormulario() {
  return JSON.stringify({
    nome: inputNome.value.trim(),
    nascimento: inputDataNascimento.value,
    modo: modoAtual(),
    data_limite: inputDataLimite.value,
  });
}

// O formulário está pronto para carregar: nome, data de nascimento e, no
// modo "data limite", também a data limite.
function formularioCompleto() {
  if (!inputNome.value.trim() || !inputDataNascimento.value) return false;
  if (modoAtual() === "data_limite" && !inputDataLimite.value) return false;
  return true;
}

async function carregarAvaliacao() {
  limparAlerta();
  assinaturaCarregada = assinaturaFormulario();

  const corpo = {
    nome: inputNome.value,
    data_nascimento: inputDataNascimento.value,
    modo: modoAtual(),
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
}

// Carrega sozinho assim que o usuário termina de preencher, sem depender do
// botão. Espera 500 ms após a última alteração e ignora dados repetidos.
function agendarAutoCarregar() {
  clearTimeout(autoCarregarTimer);
  if (!formularioCompleto() || assinaturaFormulario() === assinaturaCarregada) return;
  autoCarregarTimer = setTimeout(() => {
    if (formularioCompleto() && assinaturaFormulario() !== assinaturaCarregada) {
      carregarAvaliacao();
    }
  }, 500);
}

form.addEventListener("submit", (evento) => {
  evento.preventDefault();
  clearTimeout(autoCarregarTimer);
  carregarAvaliacao();
});
form.addEventListener("input", agendarAutoCarregar);
form.addEventListener("change", agendarAutoCarregar);

// Habilita "Salvar progresso" e os relatórios apenas quando há uma
// avaliação carregada e o paciente pode ser avaliado.
function setAcoesHabilitadas() {
  const ok = Boolean(ultimaAvaliacao && ultimaAvaliacao.avaliavel);
  btnSalvarProgresso.disabled = !ok;
  btnRelatorioResumido.disabled = !ok;
  btnRelatorioCompleto.disabled = !ok;
  btnResetarRespostas.disabled = !ok;
}

function renderizar(dados) {
  // Guarda as respostas atuais antes de recriar os painéis, para não perder
  // marcações quando a avaliação é recarregada (ex.: mudança de data limite).
  lembrarMarcacoesRenderizadas();

  ultimaAvaliacao = dados;
  paineis.innerHTML = "";
  avisoIdade.hidden = true;
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

  if (dados.idade_excede_limite) {
    avisoIdadeTexto.textContent =
      dados.mensagem ||
      "A idade do paciente já superou o limite para se adequar ao teste.";
    avisoIdade.hidden = false;
  }

  if (!dados.avaliavel) {
    totalGeralEl.textContent = "";
    setAcoesHabilitadas();
    mostrarAlerta(dados.mensagem, "warning");
    return;
  }

  totalGeralEl.textContent = "Total geral de pontos: 0";

  (dados.areas || []).forEach((area) => {
    paineis.appendChild(criarPainel(area, totalGeralEl));
    tabelaResumoCorpo.appendChild(criarLinhaTabela(area));
  });

  // Reaplica as respostas guardadas às habilidades que continuam visíveis.
  aplicarMarcacoes(marcacoesMemoria);

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
        Pontos: <span class="painel-soma">0</span> / ${area.total_habilidades}
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
    btnTeste.hidden = true; // ação mantida, mas invisível

    btnTeste.addEventListener("click", () => {
      const marcar = btnTeste.textContent === "Marcar todas";
      const alvo = marcar ? "sim" : "nao";
      card.querySelectorAll(".resposta-grupo").forEach((grupo) => {
        const radio = grupo.querySelector(`.resposta-radio[value="${alvo}"]`);
        if (radio) radio.checked = true;
      });
      btnTeste.textContent = marcar ? "Desmarcar todas" : "Marcar todas";
      lembrarMarcacoesRenderizadas();
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

  const grupo = `resp-${areaKey}-${hab.item}`;
  const opcoes = [
    ["sim", "Sim", "btn-outline-success"],
    ["av", "Às vezes", "btn-outline-warning"],
    ["nao", "Não", "btn-outline-danger"],
  ];
  const botoes = opcoes
    .map(
      ([valor, rotulo, classe]) => `
      <input type="radio" class="btn-check resposta-radio" name="${grupo}"
             id="${grupo}-${valor}" value="${valor}" autocomplete="off"
             data-faixa="${hab.faixa}" data-valor="${VALOR_RESPOSTA[valor]}"
             ${valor === RESPOSTA_PADRAO ? "checked" : ""}>
      <label class="btn btn-sm ${classe}" for="${grupo}-${valor}">${rotulo}</label>`,
    )
    .join("");

  row.innerHTML = `
    <div class="flex-grow-1">
      <span class="habilidade-item-num">${hab.item}.</span>${hab.habilidade}
    </div>
    <div class="btn-group btn-group-sm resposta-grupo" role="group"
         data-item="${hab.item}" aria-label="Resposta para a habilidade ${hab.item}">
      ${botoes}
    </div>`;

  row.querySelectorAll(".resposta-radio").forEach((radio) => {
    radio.addEventListener("change", () => {
      registrarMarcacao(areaKey, hab.item, radio.value);
      atualizarSomaPainel(card);
      atualizarTotalGeral(totalGeralEl);
      atualizarTabelaResumo();
      agendarCalculoIdade();
    });
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

// Soma dos pontos das habilidades de um painel (Sim = 1, Às vezes = 0,5).
function somaPontos(card) {
  let total = 0;
  card.querySelectorAll(".resposta-radio:checked").forEach((radio) => {
    total += Number(radio.dataset.valor) || 0;
  });
  return total;
}

function atualizarSomaPainel(card) {
  const pontos = fmtNum(somaPontos(card));
  card.querySelector(".painel-soma").textContent = pontos;
  card.querySelector(".painel-soma-rodape").textContent = pontos;
}

function atualizarTotalGeral(totalGeralEl) {
  let total = 0;
  document.querySelectorAll("#paineis .resposta-radio:checked").forEach((radio) => {
    total += Number(radio.dataset.valor) || 0;
  });
  totalGeralEl.textContent = `Total geral de pontos: ${fmtNum(total)}`;
}

function atualizarTabelaResumo() {
  let totalPontos = 0;
  let totalMaximo = 0;

  paineis.querySelectorAll(".card").forEach((card) => {
    const pontos = somaPontos(card);
    totalPontos += pontos;

    const linha = tabelaResumoCorpo.querySelector(`tr[data-area="${card.dataset.area}"]`);
    if (linha) {
      linha.querySelector(".tabela-pontos").textContent = fmtNum(pontos);
      totalMaximo += Number(linha.querySelector(".tabela-maximo").textContent) || 0;
    }
  });

  tabelaResumoTotal.textContent = fmtNum(totalPontos);
  tabelaResumoTotalMaximo.textContent = totalMaximo;
}

// --- Idade de desenvolvimento --------------------------------------------

// Soma os pontos por área e por faixa etária (índice 0 a 5).
function coletarPontosPorFaixa() {
  const pontos = {};
  paineis.querySelectorAll(".card").forEach((card) => {
    const faixas = new Array(NUM_FAIXAS).fill(0);
    card.querySelectorAll(".resposta-radio:checked").forEach((radio) => {
      const faixa = Number(radio.dataset.faixa);
      const valor = Number(radio.dataset.valor) || 0;
      if (faixa >= 0 && faixa < NUM_FAIXAS) faixas[faixa] += valor;
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

// Rótulo com o valor (1 casa) acima das barras de todos os conjuntos
// ("Idade de desenvolvimento" e "Idade atual do paciente").
const rotuloValoresPlugin = {
  id: "rotuloValores",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!meta || meta.hidden) return;
      meta.data.forEach((barra, i) => {
        const valor = dataset.data[i];
        if (valor == null) return;
        ctx.fillText(Number(valor).toFixed(1), barra.x, barra.y - 4);
      });
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

// Reúne as áreas com a resposta atual de cada habilidade (Sim / Às vezes / Não).
function coletarAreasComMarcacao() {
  if (!ultimaAvaliacao || !ultimaAvaliacao.areas) return [];
  return ultimaAvaliacao.areas.map((area) => ({
    key: area.key,
    label: area.label,
    habilidades: area.habilidades.map((h) => {
      const resposta = respostaSelecionada(area.key, h.item);
      return {
        item: h.item,
        habilidade: h.habilidade,
        faixa: h.faixa,
        resposta,
        valor: VALOR_RESPOSTA[resposta],
      };
    }),
  }));
}

// Valor ("sim" | "av" | "nao") do grupo de radios de uma habilidade.
function respostaSelecionada(areaKey, item) {
  const marcado = document.querySelector(`input[name="resp-${areaKey}-${item}"]:checked`);
  return marcado ? marcado.value : RESPOSTA_PADRAO;
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

// Marcacoes atuais: { "<area>": { "<item>": "sim" | "av" | "nao" } }.
function coletarMarcacoes() {
  const marcacoes = {};
  paineis.querySelectorAll(".card").forEach((card) => {
    const itens = {};
    card.querySelectorAll(".resposta-grupo").forEach((grupo) => {
      const marcado = grupo.querySelector(".resposta-radio:checked");
      itens[grupo.dataset.item] = marcado ? marcado.value : RESPOSTA_PADRAO;
    });
    marcacoes[card.dataset.area] = itens;
  });
  return marcacoes;
}

function salvarProgresso() {
  if (!ultimaAvaliacao || !ultimaAvaliacao.avaliavel) return;

  lembrarMarcacoesRenderizadas();
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
    marcacoes: marcacoesMemoria,
  };

  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
  baixarArquivo(blob, nomeArquivoSaida("json"));
  acoesStatus.textContent = "Progresso salvo.";
}

// Aplica as marcacoes salvas aos grupos de radios ja renderizados e recalcula.
// Aceita o formato atual ("sim"/"av"/"nao") e o antigo (booleano => "sim").
function aplicarMarcacoes(marcacoes) {
  Object.entries(marcacoes || {}).forEach(([areaKey, itens]) => {
    Object.entries(itens || {}).forEach(([item, valor]) => {
      let resposta = valor;
      if (valor === true) resposta = "sim";
      else if (valor === false || valor == null) resposta = "nao";
      if (!(resposta in VALOR_RESPOSTA)) resposta = RESPOSTA_PADRAO;
      const radio = document.querySelector(
        `input[name="resp-${areaKey}-${item}"][value="${resposta}"]`,
      );
      if (radio) radio.checked = true;
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

  // Substitui a memória de respostas pelas do arquivo (normalizando o
  // formato antigo) antes de renderizar, que já as reaplica.
  marcacoesMemoria = {};
  Object.entries(estado.marcacoes || {}).forEach(([areaKey, itens]) => {
    marcacoesMemoria[areaKey] = {};
    Object.entries(itens || {}).forEach(([item, valor]) => {
      marcacoesMemoria[areaKey][item] = normalizarResposta(valor);
    });
  });

  limparAlerta();
  // Evita que o auto-carregamento dispare por causa das alterações acima e
  // recarregue a avaliação por cima das marcações restauradas.
  clearTimeout(autoCarregarTimer);
  assinaturaCarregada = assinaturaFormulario();
  renderizar(estado.avaliacao);

  const quando = (estado.salvo_em || "").replace("T", " ").slice(0, 16);
  acoesStatus.textContent = `Progresso restaurado${quando ? ` (salvo em ${quando})` : ""}.`;
}

// Zera todas as respostas das áreas avaliadas (não mexe nos dados do
// paciente). Pede confirmação porque as marcações são perdidas.
function resetarRespostas() {
  if (!ultimaAvaliacao || !ultimaAvaliacao.avaliavel) return;

  const confirmado = window.confirm(
    "Resetar todas as respostas das áreas avaliadas?\n\n" +
      'Todas as marcações "Sim" e "Às vezes" voltam para "Não". ' +
      "Os dados do paciente não são alterados.\n" +
      "Esta ação não pode ser desfeita.",
  );
  if (!confirmado) return;

  marcacoesMemoria = {};
  paineis.querySelectorAll('.resposta-radio[value="nao"]').forEach((radio) => {
    radio.checked = true;
  });

  const totalGeralEl = document.getElementById("resumo-total-geral");
  paineis.querySelectorAll(".card").forEach((card) => atualizarSomaPainel(card));
  atualizarTotalGeral(totalGeralEl);
  atualizarTabelaResumo();
  calcularIdadeDesenvolvimento();
  acoesStatus.textContent = "Respostas resetadas — todas as marcações foram perdidas.";
}

btnSalvarProgresso.addEventListener("click", salvarProgresso);
btnResetarRespostas.addEventListener("click", resetarRespostas);
btnRestaurarProgresso.addEventListener("click", () => inputRestaurarProgresso.click());
inputRestaurarProgresso.addEventListener("change", (evento) => {
  const arquivo = evento.target.files && evento.target.files[0];
  if (arquivo) restaurarProgresso(arquivo);
  evento.target.value = "";
});
