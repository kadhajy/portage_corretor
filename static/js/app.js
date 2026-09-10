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
const relatorioPrint = document.getElementById("relatorio-print");

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
// Uma cor por área nas barras de "Idade de desenvolvimento". Linguagem
// (índice 1) usa roxo para não colidir com o laranja da barra "Idade atual
// do paciente" (#ED7D31).
const CORES_AREAS = ["#5B9BD5", "#8064A2", "#A5A5A5", "#FFC000", "#70AD47"];

// ===========================================================================
// Regras de cálculo (aplicação estática — sem backend). Portadas do
// antigo backend Flask.
// ===========================================================================

// Limite de idade do Guia Portage: 6 anos = 72 meses. Acima disso a avaliação
// continua disponível, mas a página exibe um aviso.
const MAX_MESES = 72;

const FAIXAS = [
  "0 a 1 ano",
  "1 a 2 anos",
  "2 a 3 anos",
  "3 a 4 anos",
  "4 a 5 anos",
  "5 a 6 anos",
];

// Total de habilidades de cada faixa segundo o Guia Portage
// (fonte: tabela_calculo_portage.xlsx, linha 10).
const DIVISORES_IDADE_DESENV = {
  socializacao: [28, 16, 8, 12, 9, 11],
  linguagem: [10, 18, 30, 24, 15, 14],
  cognicao: [14, 10, 16, 24, 22, 22],
  autocuidados: [13, 12, 27, 15, 23, 15],
  des_mot: [45, 18, 17, 15, 16, 29],
};

const ROTULO_RESPOSTA = { sim: "Sim", av: "Às vezes", nao: "Não" };

// Habilidades por área, carregadas de data/portage.json.
let dadosPortage = null;

function faixaIndice(rangeI) {
  return Math.max(0, Math.min(FAIXAS.length - 1, Math.floor(Number(rangeI) / 12)));
}

// "YYYY-MM-DD" -> Date à meia-noite local; lança erro se inválida.
function parseDataISO(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor || "");
  if (!m) throw new Error("data invalida");
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getFullYear() !== ano || dt.getMonth() !== mes - 1 || dt.getDate() !== dia) {
    throw new Error("data invalida");
  }
  return dt;
}

function dataISO(dt) {
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

// Meses de vida completos: (ano*12 + mês), menos 1 se o dia ainda não chegou.
function mesesDeVida(nascimento, referencia) {
  let meses =
    (referencia.getFullYear() - nascimento.getFullYear()) * 12 +
    (referencia.getMonth() - nascimento.getMonth());
  if (referencia.getDate() < nascimento.getDate()) meses -= 1;
  return meses;
}

function filtrarAreas(meses) {
  return dadosPortage.areas.map((area) => {
    const habilidades = area.items
      .filter((item) => item.habilidade && meses >= item.range_i)
      .map((item) => ({
        item: item.item,
        habilidade: item.habilidade,
        range_i: item.range_i,
        faixa: faixaIndice(item.range_i),
      }));
    return {
      key: area.key,
      label: area.label,
      habilidades,
      total_habilidades: habilidades.length,
    };
  });
}

// Idade de desenvolvimento (anos) de uma área. `pontosPorFaixa` tem um valor
// por faixa (Sim = 1, Às vezes = 0,5). ROUND com 0,5 para cima; limite de 6.
function idadeDesenvolvimento(pontosPorFaixa, divisores) {
  let bruto = 0;
  for (let i = 0; i < divisores.length; i++) {
    const divisor = divisores[i];
    if (divisor) bruto += ((Number(pontosPorFaixa[i] || 0) * 12) / divisor) / 12;
  }
  let anos = Math.floor(bruto + 0.5);
  anos = Math.min(anos, IDADE_MAX_ANOS);
  return { valor_bruto: Math.round(bruto * 10000) / 10000, anos };
}

// Equivalente ao antigo POST /api/avaliacao.
function montarAvaliacao({ nome, data_nascimento, modo, data_limite }) {
  nome = (nome || "").trim();
  if (!nome) throw new Error("Informe o nome do paciente.");

  let nascimento;
  try {
    nascimento = parseDataISO(data_nascimento);
  } catch {
    throw new Error("Data de nascimento inválida.");
  }

  let referencia;
  if (modo === "data_limite") {
    try {
      referencia = parseDataISO(data_limite);
    } catch {
      throw new Error("Data limite inválida.");
    }
  } else {
    const hoje = new Date();
    referencia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  }

  if (referencia < nascimento) {
    throw new Error("A data de referência é anterior à data de nascimento.");
  }

  const meses = mesesDeVida(nascimento, referencia);
  const idadeExcedeLimite = meses >= MAX_MESES;

  const dados = {
    nome,
    data_nascimento: dataISO(nascimento),
    modo: modo === "data_limite" ? "data_limite" : "hoje",
    data_referencia: dataISO(referencia),
    meses_de_vida: meses,
    anos: Math.floor(meses / 12),
    meses_restantes: meses % 12,
    idade_maxima_meses: MAX_MESES,
    avaliavel: true,
    idade_excede_limite: idadeExcedeLimite,
    areas: filtrarAreas(meses),
  };

  if (idadeExcedeLimite) {
    dados.mensagem =
      `O paciente tem ${meses} meses de vida ` +
      `(${Math.floor(meses / 12)} ano(s) e ${meses % 12} mês(es)), acima do limite de ` +
      "71 meses (6 anos) previsto pelo Guia Portage. A avaliação continua " +
      "disponível, mas os resultados podem não refletir com precisão o " +
      "desenvolvimento nesta faixa etária. Se preferir, informe uma data " +
      "limite para enquadrar a idade dentro do intervalo do teste.";
  }

  return dados;
}

// Equivalente ao antigo POST /api/resultado.
function calcularResultado(pontos) {
  const areas = [];
  dadosPortage.areas.forEach((area) => {
    const divisores = DIVISORES_IDADE_DESENV[area.key];
    if (!divisores) return;
    const brutos = pontos[area.key] || [];
    const porFaixa = [];
    for (let i = 0; i < FAIXAS.length; i++) porFaixa.push(Number(brutos[i]) || 0);
    const calc = idadeDesenvolvimento(porFaixa, divisores);
    areas.push({
      key: area.key,
      label: area.label,
      pontos_por_faixa: porFaixa,
      valor_bruto: calc.valor_bruto,
      idade_anos: calc.anos,
    });
  });
  return { faixas: FAIXAS, areas };
}

function valorResposta(resposta) {
  return VALOR_RESPOSTA[resposta] != null ? VALOR_RESPOSTA[resposta] : 0;
}

// Números do relatório para uma área (equivalente ao antigo _calcular_area).
function calcularAreaRelatorio(area) {
  const habilidades = area.habilidades || [];
  const pontos = habilidades.reduce((s, h) => s + valorResposta(h.resposta), 0);

  const porFaixa = new Array(FAIXAS.length).fill(0);
  habilidades.forEach((h) => {
    const v = valorResposta(h.resposta);
    const fi = Number(h.faixa) || 0;
    if (v && fi >= 0 && fi < FAIXAS.length) porFaixa[fi] += v;
  });

  const divisores = DIVISORES_IDADE_DESENV[area.key];
  const idade = divisores ? idadeDesenvolvimento(porFaixa, divisores).anos : null;

  return {
    key: area.key,
    label: area.label,
    habilidades,
    pontos,
    maximo: habilidades.length,
    idade_anos: idade,
  };
}

// Escapa texto para inserção segura no HTML do relatório.
function esc(valor) {
  return String(valor == null ? "" : valor).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}

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

function carregarAvaliacao() {
  limparAlerta();

  if (!dadosPortage) {
    mostrarAlerta("Dados da avaliação ainda não carregados (data/portage.json).", "danger");
    return;
  }

  assinaturaCarregada = assinaturaFormulario();

  let resposta;
  try {
    resposta = montarAvaliacao({
      nome: inputNome.value,
      data_nascimento: inputDataNascimento.value,
      modo: modoAtual(),
      data_limite: inputDataLimite.value,
    });
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

function renderizar(dados, { preservarMarcacoes = true } = {}) {
  // Guarda as respostas atuais antes de recriar os painéis, para não perder
  // marcações quando a avaliação é recarregada (ex.: mudança de data limite).
  // Na restauração de um progresso isso é pulado: `marcacoesMemoria` já é a
  // memória vinda do arquivo e não deve ser sobrescrita pelos painéis na tela.
  if (preservarMarcacoes) lembrarMarcacoesRenderizadas();

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
    `Data de referência: ${formatarData(dados.data_referencia)}`;
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

function calcularIdadeDesenvolvimento() {
  if (!dadosPortage) return;
  renderTabelaIdade(calcularResultado(coletarPontosPorFaixa()));
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

// Fundo branco no canvas para o gráfico sair legível no relatório impresso.
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
function configGraficoIdade(dados, paraImpressao) {
  const labels = dados.areas.map((a) => a.label);
  const desenvolvimento = dados.areas.map((a) => Math.round(a.valor_bruto * 10) / 10);

  const idadeAtualAnos = ultimaAvaliacao
    ? Math.min(IDADE_MAX_ANOS, Math.round((ultimaAvaliacao.meses_de_vida / 12) * 10) / 10)
    : 0;
  const idadeAtualSerie = labels.map(() => idadeAtualAnos);

  return {
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
      // No relatório o gráfico é desenhado num canvas próprio de tamanho fixo.
      responsive: !paraImpressao,
      maintainAspectRatio: false,
      // Sem animação o desenho é síncrono; a imagem do relatório já sai completa.
      animation: false,
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
        legend: {
          position: "bottom",
          // A série "Idade de desenvolvimento" tem uma cor por área; a legenda
          // padrão mostraria só um quadradinho. Aqui listamos cada área com a
          // sua cor + a barra de referência da idade atual.
          labels: {
            generateLabels(chart) {
              const cores = chart.data.datasets[0].backgroundColor;
              const itens = chart.data.labels.map((texto, i) => ({
                text: texto,
                fillStyle: cores[i],
                strokeStyle: cores[i],
                lineWidth: 0,
              }));
              const ref = chart.data.datasets[1];
              itens.push({
                text: ref.label,
                fillStyle: ref.backgroundColor,
                strokeStyle: ref.backgroundColor,
                lineWidth: 0,
              });
              return itens;
            },
          },
          onClick() {},
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)} ano(s)`,
          },
        },
      },
    },
    plugins: [fundoBrancoPlugin, rotuloValoresPlugin],
  };
}

function renderGraficoIdade(dados) {
  if (typeof Chart === "undefined" || !graficoCanvas) return;
  if (graficoIdade) graficoIdade.destroy();
  graficoIdade = new Chart(graficoCanvas, configGraficoIdade(dados, false));
  if (graficoWrapper) graficoWrapper.hidden = false;
}

// Gera o PNG do gráfico num canvas próprio de tamanho fixo, sem depender do
// estado ou da visibilidade do gráfico da tela — assim o relatório sai com o
// gráfico completo já na primeira geração.
function imagemGraficoIdade(dados) {
  if (typeof Chart === "undefined" || !dados || !dados.areas || !dados.areas.length) {
    return "";
  }
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 450;
  const chart = new Chart(canvas, configGraficoIdade(dados, true));
  // Força o desenho síncrono no canvas: sem isso o Chart.js pode adiar o
  // primeiro draw para o próximo frame e o toBase64Image() sai em branco
  // (o gráfico só aparecia na 2ª geração do relatório).
  chart.update("none");
  chart.draw();
  const img = chart.toBase64Image("image/png", 1);
  chart.destroy();
  return img;
}

// --- Relatório (impressão / PDF) --------------------------------------

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

// Monta o HTML do relatório dentro de #relatorio-print. `tipo`:
// "resumido" = tabelas + gráfico; "completo" = também a lista de habilidades.
function montarRelatorioImpresso(tipo) {
  const dados = ultimaAvaliacao;
  const areas = coletarAreasComMarcacao().map(calcularAreaRelatorio);

  const dataRef = formatarData(dados.data_referencia);

  const totalPontos = areas.reduce((s, a) => s + a.pontos, 0);
  const totalMaximo = areas.reduce((s, a) => s + a.maximo, 0);
  const graficoImg = imagemGraficoIdade(calcularResultado(coletarPontosPorFaixa()));

  const linhasResumo = areas
    .map((a) => `<tr><td>${esc(a.label)}</td><td>${fmtNum(a.pontos)}</td><td>${a.maximo}</td></tr>`)
    .join("");
  const linhasIdade = areas
    .map((a) => {
      const anos = a.idade_anos;
      const texto = anos == null ? "-" : `${anos} ano${anos === 1 ? "" : "s"}`;
      return `<tr><td>${esc(a.label)}</td><td>${texto}</td></tr>`;
    })
    .join("");

  let html = `
    <h1>Relatório de Avaliação do Desenvolvimento Infantil</h1>
    <p class="rel-sub"><em>Baseado no Guia Portage</em></p>

    <h2>Dados do paciente</h2>
    <ul>
      <li>Nome: ${esc(dados.nome)}</li>
      <li>Data de nascimento: ${formatarData(dados.data_nascimento)}</li>
      <li>Data de avaliação: ${esc(dataRef)}</li>
      <li>Idade: ${dados.anos} ano(s) e ${dados.meses_restantes} mês(es) — ${dados.meses_de_vida} meses de vida</li>
    </ul>`;

  if (dados.idade_excede_limite) {
    html += `<p class="rel-aviso">${esc(dados.mensagem || "")}</p>`;
  }

  html += `
    <h2>Somatório de pontos por seção</h2>
    <table>
      <thead><tr><th>Seção</th><th>Pontos</th><th>Máximo de pontos</th></tr></thead>
      <tbody>
        ${linhasResumo}
        <tr class="rel-total"><td>Total geral</td><td>${fmtNum(totalPontos)}</td><td>${totalMaximo}</td></tr>
      </tbody>
    </table>

    <h2>Idade de desenvolvimento estimada</h2>
    <p class="rel-nota">Cálculo baseado na planilha de referência do Guia Portage
    (limite de 6 anos). É apenas um guia e não substitui a avaliação de um
    profissional qualificado.</p>
    <table>
      <thead><tr><th>Seção</th><th>Idade de desenvolvimento</th></tr></thead>
      <tbody>${linhasIdade}</tbody>
    </table>`;

  if (graficoImg) {
    html += `<h2>Idade de desenvolvimento (gráfico)</h2>
      <img class="rel-grafico" src="${graficoImg}" alt="Gráfico de idade de desenvolvimento">`;
  }

  if (tipo === "completo") {
    html += `<div class="rel-quebra"></div><h2>Habilidades avaliadas</h2>`;
    areas.forEach((a) => {
      html += `<h3>${esc(a.label)}</h3>`;
      if (!a.habilidades.length) {
        html += `<p>Nenhuma habilidade se aplica a esta idade.</p>`;
        return;
      }
      const linhas = a.habilidades
        .map(
          (h) =>
            `<tr><td>${esc(h.item)}</td><td>${esc(h.habilidade)}</td><td>${ROTULO_RESPOSTA[h.resposta] || "Não"}</td></tr>`,
        )
        .join("");
      html += `<table><thead><tr><th>Item</th><th>Habilidade</th><th>Resposta</th></tr></thead>
        <tbody>${linhas}</tbody></table>`;
    });
  }

  html += `
    <div class="rel-assinatura">
      <p>_____________________________________________</p>
      <p>Profissional</p>
    </div>`;

  relatorioPrint.innerHTML = html;
}

// Espera as imagens do container terminarem de decodificar. Imagens data: URI
// carregam de forma assíncrona; sem esperar, a 1ª geração do relatório saía
// sem o gráfico (só aparecia ao gerar de novo, já com a imagem em cache).
function aguardarImagens(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      const carregou = new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
      return img.decode().catch(() => carregou);
    }),
  );
}

// Abre a caixa de impressão do navegador com o relatório; o usuário escolhe
// "Salvar como PDF". O título da aba vira o nome sugerido do arquivo.
async function imprimirRelatorio(tipo) {
  if (!ultimaAvaliacao || !ultimaAvaliacao.avaliavel) return;

  lembrarMarcacoesRenderizadas();
  montarRelatorioImpresso(tipo);
  await aguardarImagens(relatorioPrint);

  const tituloOriginal = document.title;
  document.title = nomeBaseSaida();
  const restaurar = () => {
    document.title = tituloOriginal;
    window.removeEventListener("afterprint", restaurar);
  };
  window.addEventListener("afterprint", restaurar);

  acoesStatus.textContent = 'Na caixa de impressão, escolha "Salvar como PDF".';
  window.print();
  setTimeout(restaurar, 2000);
}

btnRelatorioResumido.addEventListener("click", () => imprimirRelatorio("resumido"));
btnRelatorioCompleto.addEventListener("click", () => imprimirRelatorio("completo"));

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

// Base do nome de saída: ava_<nome do paciente>_<yyyymmdd>
function nomeBaseSaida() {
  const nome = ultimaAvaliacao ? ultimaAvaliacao.nome : "";
  return `ava_${nomePacienteLimpo(nome)}_${dataArquivo()}`;
}

// Padrão: ava_<nome do paciente>_<yyyymmdd>.<extensao>
function nomeArquivoSaida(extensao) {
  return `${nomeBaseSaida()}.${extensao}`;
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
      // A data de avaliação é sempre gravada de forma explícita, inclusive
      // no modo "hoje" (que serve só para agilizar o preenchimento). Sem
      // isso, restaurar o backup dias depois recalcularia a idade para a
      // data da restauração em vez da data em que a avaliação foi feita.
      modo: "data_limite",
      data_limite: ultimaAvaliacao.data_referencia,
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

  // A data de avaliação vem congelada no backup. Formatos novos gravam-na
  // em formulario.data_limite; backups antigos feitos no modo "hoje" não a
  // gravavam, então usa avaliacao.data_referencia. Restaura-se sempre como
  // "data limite" para que um recálculo posterior não use a data de hoje.
  const dataAvaliacao =
    f.data_limite || (estado.avaliacao && estado.avaliacao.data_referencia) || "";
  inputDataLimite.value = dataAvaliacao;
  const radio = document.getElementById(dataAvaliacao ? "modo-limite" : "modo-hoje");
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
  renderizar(estado.avaliacao, { preservarMarcacoes: false });

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

// --- Dados da avaliação -----------------------------------------------
// Carregados de data/portage.json. A página precisa ser servida por HTTP
// (ex.: python3 -m http.server); aberta como file:// o fetch é bloqueado
// pela política de segurança do navegador.
fetch("data/portage.json")
  .then((resp) => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  })
  .then((dados) => {
    if (!dados || !Array.isArray(dados.areas)) {
      throw new Error("formato inesperado");
    }
    dadosPortage = dados;
    // Se o formulário já estiver preenchido (ex.: restaurou o progresso), carrega.
    if (formularioCompleto()) carregarAvaliacao();
  })
  .catch((erro) => {
    mostrarAlerta(
      `Não foi possível carregar os dados da avaliação (data/portage.json): ${erro.message}. ` +
        "Sirva a página por HTTP em vez de abrir o arquivo direto.",
      "danger",
    );
  });
