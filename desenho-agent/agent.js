// Agente local de busca + impressão de desenho técnico — Central Expedição
//
// Roda numa máquina da rede interna que enxerga o servidor de arquivos
// on-premises (PASTA_PROJETOS, ex.: "D:\Engenharia\0 - Engenharia do
// Produto\02 - Projetos\") e que também consegue imprimir na
// impressora a laser do romaneio de Produção (a mesma do
// print-agent/, só que vista/instalada aqui com o nome configurado em
// IMPRESSORA_DESENHOS_NOME — pode ser diferente do nome usado no
// computador do Almoxarifado, mesmo sendo a mesma impressora física).
//
// Diferente do print-agent/ (etiqueta e romaneio), aqui o backend NÃO
// gera nem guarda o PDF — ele só registra "procure o desenho do item
// X" (backend/routes/romaneiosProducao.js enfileira isso sempre que um
// código de item bate com o padrão NNNNNN-LLLddd, ex.: 250013-DGA109).
// Este agente é quem busca o arquivo de verdade nas pastas e manda pra
// impressora, sem passar o arquivo pelo backend.
//
// Estrutura de pastas esperada (fixa, sempre 2 níveis):
//   PASTA_PROJETOS\
//     250013-HRS02510T - Frivatti\        (começa com o nº do projeto)
//       DGA - Dutos de Gases e Ar\        (começa com as 3 letras da estrutura)
//         250013-HRS02510T-DGA109-R00.pdf (contém projeto + estrutura + revisão)
//
// Como o "HRS02510T" no meio do nome não dá pra prever a partir do
// código lido, a busca é por PREFIXO nas pastas e por um padrão que
// aceita qualquer coisa no meio no nome do arquivo. Se houver mais de
// uma revisão (R00, R01, ...), sempre imprime a mais alta.
//
// Este agente também atende o perfil Pintura (tela "Imprimir
// Desenhos"), que pede TODOS os desenhos de uma estrutura de uma vez
// (não um item específico) — ver processarJobLote abaixo. Nesse caso a
// pasta da estrutura pode ter mais um nível: uma subpasta batizada com
// o código completo da estrutura, agrupando só as peças daquela faixa,
// ex.:
//   250492-MAG06015T - Oleoplan\
//     TCR - Transportador de Correia de Roletes\
//       TCR-500\                              (faixa TCR500-TCR595)
//         250492-MAG06015T-TCR500-R00.pdf
//         250492-MAG06015T-TCR501-R00.pdf
//         ...

require('dotenv').config();
const { print } = require('pdf-to-printer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { gerarRelatorioLotePDF } = require('./relatorioLote');

const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const PASTA_PROJETOS = process.env.PASTA_PROJETOS || '';
const IMPRESSORA_DESENHOS_NOME = process.env.IMPRESSORA_DESENHOS_NOME || '';

if (!API_URL) {
  console.error('[config] API_URL não configurada. Copie .env.example para .env e preencha.');
  process.exit(1);
}
if (!AGENT_API_KEY) {
  console.error('[config] AGENT_API_KEY não configurada. Use o mesmo valor do backend/.env.');
  process.exit(1);
}
if (!PASTA_PROJETOS) {
  console.error('[config] PASTA_PROJETOS não configurada. Copie .env.example para .env e preencha.');
  process.exit(1);
}
if (!IMPRESSORA_DESENHOS_NOME) {
  console.error('[config] IMPRESSORA_DESENHOS_NOME não configurada. Copie .env.example para .env e preencha.');
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`, ...args);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function buscarPendentes() {
  const resp = await fetch(`${API_URL}/api/desenhos-tecnicos/pendentes`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET /pendentes falhou: HTTP ${resp.status}`);
  }
  return resp.json();
}

async function marcarConcluido(id) {
  await fetch(`${API_URL}/api/desenhos-tecnicos/${id}/concluido`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
}

async function marcarErro(id, mensagem) {
  await fetch(`${API_URL}/api/desenhos-tecnicos/${id}/erro`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ erro: String(mensagem).slice(0, 300) }),
  });
}

// ── Fila de impressão EM LOTE (perfil Pintura) ─────────────
async function buscarPendentesLote() {
  const resp = await fetch(`${API_URL}/api/desenhos-tecnicos-lote/pendentes`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET /desenhos-tecnicos-lote/pendentes falhou: HTTP ${resp.status}`);
  }
  return resp.json();
}

async function marcarLoteConcluido(id, quantidadeImpressa, quantidadeErro) {
  await fetch(`${API_URL}/api/desenhos-tecnicos-lote/${id}/concluido`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantidade_impressa: quantidadeImpressa, quantidade_erro: quantidadeErro }),
  });
}

async function marcarLoteErro(id, mensagem) {
  await fetch(`${API_URL}/api/desenhos-tecnicos-lote/${id}/erro`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ erro: String(mensagem).slice(0, 300) }),
  });
}

// Lista subpastas de `dir` cujo nome comece com `prefixo` (sem
// diferenciar maiúsculas/minúsculas). Lança erro descritivo se achar
// zero ou mais de uma — ambiguidade aqui é pior que travar, porque
// imprimiria o desenho errado.
async function acharSubpastaPorPrefixo(dir, prefixo, descricaoNivel) {
  let entradas;
  try {
    entradas = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Não foi possível abrir a pasta "${dir}": ${err.message}`);
  }
  const prefixoNorm = prefixo.toUpperCase();
  const candidatas = entradas
    .filter((e) => e.isDirectory() && e.name.toUpperCase().startsWith(prefixoNorm))
    .map((e) => e.name);

  if (candidatas.length === 0) {
    throw new Error(`${descricaoNivel} "${prefixo}" não encontrada dentro de "${dir}".`);
  }
  if (candidatas.length > 1) {
    throw new Error(`Mais de uma pasta de ${descricaoNivel.toLowerCase()} "${prefixo}" encontrada dentro de "${dir}" (${candidatas.join(', ')}) — ambíguo.`);
  }
  return path.join(dir, candidatas[0]);
}

// Acha, dentro de `dir`, o .pdf cujo nome contenha projeto+estrutura e
// termine em "-R<número>.pdf" — entre as revisões encontradas, escolhe
// sempre a de maior número (a mais atual).
async function acharArquivoDesenho(dir, projeto, estrutura) {
  let entradas;
  try {
    entradas = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Não foi possível abrir a pasta "${dir}": ${err.message}`);
  }

  const padrao = new RegExp(
    `^${escapeRegExp(projeto)}-.+-${escapeRegExp(estrutura)}-R(\\d+)\\.pdf$`,
    'i'
  );

  let melhor = null; // { nome, revisao }
  for (const entrada of entradas) {
    if (!entrada.isFile()) continue;
    const m = padrao.exec(entrada.name);
    if (!m) continue;
    const revisao = parseInt(m[1], 10);
    if (!melhor || revisao > melhor.revisao) {
      melhor = { nome: entrada.name, revisao };
    }
  }

  if (!melhor) {
    throw new Error(`Nenhum arquivo "${projeto}-...-${estrutura}-R##.pdf" encontrado em "${dir}".`);
  }
  return path.join(dir, melhor.nome);
}

// Deixa só letras e números, em maiúsculas — usado pra comparar nomes
// de pasta/arquivo ignorando hífen, espaço e outras pontuações (ex.:
// "TCR-500" e "TCR500" viram a mesma coisa: "TCR500").
function normalizar(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Acha, dentro de `dir`, uma subpasta cujo nome normalizado seja
// EXATAMENTE igual ao código completo da estrutura (ex.: pasta
// "TCR-500" bate com o código "TCR500"). Diferente de
// acharSubpastaPorPrefixo, aqui a ausência de uma pasta assim não é
// erro — significa que a estrutura não tem essa subdivisão em faixas,
// e os PDFs ficam direto na pasta da estrutura (retorna null nesse
// caso, quem chamou decide o fallback). Mais de uma pasta batendo
// continua sendo erro — ambiguidade aqui arrisca imprimir a faixa errada.
async function acharSubpastaExata(dir, codigoCompleto, descricaoNivel) {
  let entradas;
  try {
    entradas = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Não foi possível abrir a pasta "${dir}": ${err.message}`);
  }
  const alvo = normalizar(codigoCompleto);
  const candidatas = entradas
    .filter((e) => e.isDirectory() && normalizar(e.name) === alvo)
    .map((e) => e.name);

  if (candidatas.length === 0) return null;
  if (candidatas.length > 1) {
    throw new Error(`Mais de uma pasta de ${descricaoNivel.toLowerCase()} "${codigoCompleto}" encontrada dentro de "${dir}" (${candidatas.join(', ')}) — ambíguo.`);
  }
  return path.join(dir, candidatas[0]);
}

// Varre `dir` e todas as suas subpastas (profundidade qualquer),
// retornando o caminho completo de todo arquivo .pdf encontrado — usado
// pelo modo "lote" (perfil Pintura), que imprime TUDO que achar dentro
// da pasta da estrutura (ou da subpasta da faixa, se existir).
async function listarPdfsRecursivo(dir) {
  const resultado = [];
  async function percorrer(atual) {
    let entradas;
    try {
      entradas = await fs.readdir(atual, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Não foi possível abrir a pasta "${atual}": ${err.message}`);
    }
    for (const entrada of entradas) {
      const caminho = path.join(atual, entrada.name);
      if (entrada.isDirectory()) {
        await percorrer(caminho);
      } else if (entrada.isFile() && /\.pdf$/i.test(entrada.name)) {
        resultado.push(caminho);
      }
    }
  }
  await percorrer(dir);
  return resultado;
}

// Agrupa uma lista de caminhos de PDF pela "chave da peça" (o nome do
// arquivo sem o "-R<número>" final, ex.: "250492-MAG06015T-TCR500" a
// partir de "250492-MAG06015T-TCR500-R00.pdf") e mantém só o de maior
// revisão de cada grupo — mesma regra do modo item-a-item
// (acharArquivoDesenho), só que aplicada a todos os arquivos da pasta
// de uma vez, não a um único código procurado. Arquivo sem o sufixo
// "-R<número>" vira sua própria chave (sempre incluído, sem duplicata
// possível). Resultado ordenado por chave (ordem numérica natural, ex.:
// TCR500, TCR501, ..., TCR595), só pra sair da impressora em sequência.
function agruparMaiorRevisao(caminhos) {
  const padraoRevisao = /^(.*)-R(\d+)$/i;
  const porChave = new Map(); // chave -> { caminho, revisao }

  for (const caminho of caminhos) {
    const nomeBase = path.basename(caminho, path.extname(caminho));
    const m = padraoRevisao.exec(nomeBase);
    const chave = (m ? m[1] : nomeBase).toUpperCase();
    const revisao = m ? parseInt(m[2], 10) : 0;

    const atual = porChave.get(chave);
    if (!atual || revisao > atual.revisao) {
      porChave.set(chave, { caminho, revisao });
    }
  }

  return [...porChave.entries()]
    .map(([chave, v]) => ({ chave, caminho: v.caminho }))
    .sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true }));
}

async function processarJob(job) {
  log(`Buscando desenho do item "${job.codigo_item}" (projeto ${job.projeto}, estrutura ${job.estrutura})...`);
  try {
    const pastaProjeto = await acharSubpastaPorPrefixo(PASTA_PROJETOS, job.projeto, 'Pasta do projeto');

    // As 3 primeiras letras da estrutura (ex.: "DGA" de "DGA109")
    // indicam a subpasta; o resto (o número) só entra no nome do
    // arquivo, buscado abaixo.
    const prefixoEstrutura = job.estrutura.slice(0, 3);
    const pastaEstrutura = await acharSubpastaPorPrefixo(pastaProjeto, prefixoEstrutura, 'Pasta da estrutura');

    const arquivo = await acharArquivoDesenho(pastaEstrutura, job.projeto, job.estrutura);

    log(`Encontrado "${arquivo}" — imprimindo em "${IMPRESSORA_DESENHOS_NOME}"...`);
    // Desenhos técnicos vêm do CAD em qualquer tamanho de página (A3, A1,
    // A0...), quase nunca A4. Sem "scale: fit" o SumatraPDF imprime no
    // tamanho original do PDF, cortando o que passar do papel A4 físico
    // carregado na impressora — "fit" encolhe o conteúdo pra caber
    // inteiro na página, mantendo a proporção. "paperSize: A4" garante
    // que a página impressa é sempre A4, independente do tamanho de
    // página definido dentro do PDF.
    await print(arquivo, {
      printer: IMPRESSORA_DESENHOS_NOME,
      silent: true,
      scale: 'fit',
      paperSize: 'A4',
    });

    await marcarConcluido(job.id);
    log(`Desenho do item "${job.codigo_item}" impresso com sucesso.`);
  } catch (err) {
    log(`ERRO ao buscar/imprimir desenho do item "${job.codigo_item}":`, err.message);
    await marcarErro(job.id, err.message).catch(() => {});
  }
}

// Busca e imprime TODOS os desenhos técnicos de uma estrutura (perfil
// Pintura) — diferente de processarJob acima (um item específico de
// uma caixa), aqui o pedido é só "projeto + estrutura completa"
// (ex.: "250492" + "TCR500"), sem caixa nem código de item envolvido.
async function processarJobLote(job) {
  log(`Buscando TODOS os desenhos da estrutura "${job.projeto}-${job.estrutura}"...`);
  try {
    const pastaProjeto = await acharSubpastaPorPrefixo(PASTA_PROJETOS, job.projeto, 'Pasta do projeto');

    // As 3 primeiras letras da estrutura indicam a subpasta, igual no
    // modo item-a-item.
    const prefixoEstrutura = job.estrutura.slice(0, 3);
    const pastaEstrutura = await acharSubpastaPorPrefixo(pastaProjeto, prefixoEstrutura, 'Pasta da estrutura');

    // Se existir uma subpasta batizada com o código completo da
    // estrutura (ex.: "TCR-500" dentro de "TCR - ..."), a busca fica
    // restrita a ela — essa subpasta agrupa só as peças daquela faixa
    // (TCR500 a TCR595, por exemplo), então entrar direto nela evita
    // pegar peças de outra faixa que porventura exista numa subpasta
    // irmã (ex.: "TCR-600"). Se não existir essa subdivisão, busca
    // direto na pasta da estrutura mesmo.
    const pastaLote = (await acharSubpastaExata(pastaEstrutura, job.estrutura, 'Subpasta da faixa')) || pastaEstrutura;

    const todosPdfs = await listarPdfsRecursivo(pastaLote);
    const escolhidos = agruparMaiorRevisao(todosPdfs);

    if (!escolhidos.length) {
      throw new Error(`Nenhum PDF encontrado em "${pastaLote}".`);
    }

    log(`Encontrados ${escolhidos.length} desenho(s) em "${pastaLote}" — imprimindo em "${IMPRESSORA_DESENHOS_NOME}"...`);

    let impressos = 0;
    let comErro = 0;
    const resultados = []; // { arquivo, sucesso, erro? } — vira a folha de relatório abaixo
    for (const { chave, caminho } of escolhidos) {
      const arquivo = path.basename(caminho);
      try {
        await print(caminho, {
          printer: IMPRESSORA_DESENHOS_NOME,
          silent: true,
          scale: 'fit',
          paperSize: 'A4',
        });
        impressos++;
        resultados.push({ arquivo, sucesso: true });
      } catch (err) {
        comErro++;
        resultados.push({ arquivo, sucesso: false, erro: err.message });
        log(`ERRO ao imprimir "${chave}" (${caminho}):`, err.message);
      }
    }

    // Folha de relatório (quantidade + nome de cada desenho, com o
    // resultado real de cada impressão) — sai por ÚLTIMO, depois de
    // todos os desenhos, porque só agora sabemos o que deu certo ou
    // não. Gerada e impressa como um PDF à parte (não é uma página a
    // mais dentro de cada desenho) — na prática sai na sequência, logo
    // depois do último desenho, como a folha final do lote.
    try {
      const relatorioBuffer = await gerarRelatorioLotePDF({ projeto: job.projeto, estrutura: job.estrutura, resultados });
      const caminhoRelatorio = path.join(os.tmpdir(), `relatorio-${job.projeto}-${job.estrutura}-${job.id}.pdf`);
      await fs.writeFile(caminhoRelatorio, relatorioBuffer);
      await print(caminhoRelatorio, { printer: IMPRESSORA_DESENHOS_NOME, silent: true });
      await fs.unlink(caminhoRelatorio).catch(() => {});
      log(`Folha de relatório do lote "${job.projeto}-${job.estrutura}" impressa.`);
    } catch (err) {
      // Falha só na folha de relatório não deve derrubar o lote inteiro
      // (os desenhos em si já saíram) — só loga o problema.
      log(`ERRO ao gerar/imprimir a folha de relatório de "${job.projeto}-${job.estrutura}":`, err.message);
    }

    await marcarLoteConcluido(job.id, impressos, comErro);
    log(`Lote "${job.projeto}-${job.estrutura}" concluído: ${impressos} impresso(s), ${comErro} com erro.`);
  } catch (err) {
    log(`ERRO no lote "${job.projeto}-${job.estrutura}":`, err.message);
    await marcarLoteErro(job.id, err.message).catch(() => {});
  }
}

let processando = false;

async function ciclo() {
  if (processando) return; // evita sobrepor ciclos se uma busca demorar mais que o intervalo
  processando = true;
  try {
    const pendentes = await buscarPendentes();
    for (const job of pendentes) {
      await processarJob(job);
    }
    const pendentesLote = await buscarPendentesLote();
    for (const job of pendentesLote) {
      await processarJobLote(job);
    }
  } catch (err) {
    log('ERRO ao consultar a fila:', err.message);
  } finally {
    processando = false;
  }
}

log(`Agente de desenho técnico iniciado. Consultando ${API_URL} a cada ${POLL_INTERVAL_MS / 1000}s.`);
log(`Pasta de projetos: ${PASTA_PROJETOS}`);
ciclo();
setInterval(ciclo, POLL_INTERVAL_MS);
