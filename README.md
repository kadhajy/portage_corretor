# Avaliação do Desenvolvimento Infantil — Guia Portage

Aplicação web **estática** que apoia a correção de uma avaliação do
desenvolvimento infantil baseada no **Guia Portage**. A partir da data de
nascimento do paciente (ou de uma data limite), decide quais habilidades de
cada área devem ser avaliadas, soma a pontuação de cada resposta
(Sim = 1, Às vezes = 0,5, Não = 0) e estima a idade de desenvolvimento por
área. Todo o processamento acontece no navegador — não há servidor.

> Ferramenta de apoio à criação de atividades. **Não substitui a avaliação
> de um profissional qualificado** nem serve para diagnóstico.

## Funcionalidades

- Cadastro do paciente com cálculo dos **meses de vida** por data de hoje ou
  por **data limite** informada; a avaliação carrega sozinha ao preencher.
- Pacientes com 6 anos ou mais (72 meses) continuam avaliáveis, mas a página
  mostra um aviso de que a idade superou o limite previsto pelo teste.
- Um painel colapsável por área avaliada: **Socialização, Linguagem,
  Cognição, Autocuidados e Desenvolvimento Motor**.
- Exibição apenas das habilidades compatíveis com a idade
  (`meses_de_vida >= range_i`), cada uma com resposta **Sim / Às vezes / Não**
  (Não é o padrão).
- Somatório por seção (`pontos de total`, valendo Sim = 1 e Às vezes = 0,5),
  total geral e tabela "pontos por seção / máximo de pontos".
- **Idade de desenvolvimento** estimada por área, com tabela e gráfico de
  colunas (eixo de 0 a 6 anos), no mesmo molde da planilha de referência.
- As respostas são **preservadas** ao recarregar a avaliação (ex.: ao mudar a
  data limite); só o botão **Resetar respostas** ou restaurar um progresso as
  apagam.
- **Relatórios em PDF** (resumido e completo) via impressão do navegador e
  **salvar / restaurar progresso** em `.json`.

## Requisitos

- Um navegador atual.
- Acesso à internet no navegador (Bootstrap e Chart.js vêm de CDN).

## Rodar localmente

Basta abrir `index.html` no navegador — os dados da avaliação estão
embutidos em `static/js/portage-data.js`, então não é preciso servidor.
Se preferir servir por HTTP: `python3 -m http.server 8000`.

## Publicar no GitHub Pages

1. Faça push do repositório para o GitHub.
2. Em **Settings → Pages**, selecione a branch (ex.: `main`) e a pasta `/`
   (raiz).
3. O site fica em `https://<usuario>.github.io/<repositorio>/`.

O arquivo `.nojekyll` na raiz garante que o Pages sirva os arquivos como
estão.

## Como usar

1. Preencha **nome** e **data de nascimento** do paciente.
2. Escolha como calcular os meses de vida: **data de hoje** ou **data
   limite**. Se o paciente tiver 72 meses ou mais, a avaliação ainda carrega,
   com um aviso no topo; informe uma data limite se quiser enquadrar a idade
   no intervalo do teste.
3. A avaliação carrega sozinha assim que esses campos estão preenchidos; o
   botão **Recarregar** força uma nova carga com os mesmos dados. Os painéis
   de cada área aparecem com as habilidades da faixa etária.
4. Em cada habilidade escolha **Sim**, **Às vezes** ou **Não** (todas começam
   em "Não"). Os somatórios, a tabela de idade de desenvolvimento e o gráfico
   se atualizam sozinhos.
5. No card **Ações**, ao final da página:
   - **Salvar progresso (.json)** — baixa o estado atual da avaliação.
   - **Restaurar progresso** — carrega um `.json` salvo antes.
   - **Relatório resumido / completo (PDF)** — abre a caixa de impressão do
     navegador; escolha **"Salvar como PDF"** como destino. O resumido traz as
     duas tabelas e o gráfico; o completo também lista as habilidades
     avaliadas com a resposta de cada uma.
   - **Resetar respostas** — pede confirmação e volta todas as marcações das
     áreas para "Não"; não altera os dados do paciente.

O `.json` salvo e o nome sugerido do PDF seguem o padrão:

```
ava_<nome do paciente, sem acentos, com espaços>_<yyyymmdd>
```

onde a data é a data limite (quando usada) ou a data de geração.

## Dados da avaliação

As habilidades ficam em dois arquivos com o mesmo conteúdo:

- `static/js/portage-data.js` (`window.PORTAGE_DATA`) — é o que a página usa.
- `data/portage.json` — mesma base, mantida como referência legível e para
  quem preferir carregá-la via `fetch`.

Foram gerados de uma planilha `tabela_portage.xlsx` (5 planilhas, uma por
área; colunas `item`, `habilidade`, `range_i`, `range_f`, `realiza`; linhas
com `habilidade` em branco são ignoradas), que **não faz parte do
repositório**.

Para alterar as habilidades, coloque uma `tabela_portage.xlsx` nesse formato
na raiz do projeto e regenere os dois arquivos:

```bash
pip install openpyxl        # única dependência Python
python scripts/xlsx_to_json.py
```

Se editar `data/portage.json` na mão, replique a mudança em
`static/js/portage-data.js` (é `window.PORTAGE_DATA = ` seguido do mesmo
JSON).

Os divisores usados no cálculo da idade de desenvolvimento vêm de
`tabela_calculo_portage.xlsx` e estão fixos em `DIVISORES_IDADE_DESENV`
(`static/js/app.js`).

## Estrutura do projeto

```
index.html                  # página única (raiz — servida pelo GitHub Pages)
.nojekyll                    # publica os arquivos sem processamento Jekyll
static/js/app.js             # regras de cálculo + interface + relatórios
static/js/portage-data.js    # habilidades por área (window.PORTAGE_DATA)
static/css/style.css         # ajustes visuais + estilos de impressão
data/portage.json            # mesma base em JSON (referência / uso via fetch)
scripts/xlsx_to_json.py      # regenera os dois arquivos a partir do .xlsx (requer openpyxl)
tabela_calculo_portage.xlsx  # molde do cálculo da idade de desenvolvimento
```

> `tabela_portage.xlsx` (molde das habilidades) não é versionada; forneça-a
> na raiz apenas se for regenerar `data/portage.json`.

## Observações

- `MODO_TESTE` em `static/js/app.js` cria botões "Marcar/Desmarcar todas"
  por seção para facilitar testes. Eles ficam ocultos (`hidden`); para usar,
  remova esse `hidden` no bloco `--- MODO_TESTE ---`. Na versão final,
  defina `MODO_TESTE = false`.
