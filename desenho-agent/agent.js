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

require('dotenv').config();
const { print } = require('pdf-to-printer');
const fs = require('fs/promises');
const path = require('path');

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

let processando = false;

async function ciclo() {
  if (processando) return; // evita sobrepor ciclos se uma busca demorar mais que o intervalo
  processando = true;
  try {
    const pendentes = await buscarPendentes();
    for (const job of pendentes) {
      await processarJob(job);
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
