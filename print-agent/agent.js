// Agente local de impressão de etiquetas — Central Expedição
//
// Roda neste computador (o "computador-ponte"), ligado por USB às duas
// impressoras Argox OS-214 Plus (uma do Almoxarifado, outra da Expedição).
// O backend fica na nuvem e não enxerga essas impressoras diretamente —
// por isso ele só ENFILEIRA os pedidos de etiqueta (tabela etiqueta_fila);
// este agente é quem, de tempos em tempos, busca a fila, baixa o PDF já
// pronto (100mm x 70mm, com código de barras) e manda pra impressora certa.
//
// Não precisa de print server nem de diálogo de impressão — usa o
// pacote pdf-to-printer (que já vem com o SumatraPDF embutido) para
// imprimir silenciosamente, sem abrir nenhuma janela.

require('dotenv').config();
const { print } = require('pdf-to-printer');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const AGENT_API_KEY = process.env.AGENT_API_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (!API_URL) {
  console.error('[config] API_URL não configurada. Copie .env.example para .env e preencha.');
  process.exit(1);
}
if (!AGENT_API_KEY) {
  console.error('[config] AGENT_API_KEY não configurada. Use o mesmo valor do backend/.env.');
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toLocaleString('pt-BR')}]`, ...args);
}

async function buscarPendentes() {
  const resp = await fetch(`${API_URL}/api/etiquetas/pendentes`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET /pendentes falhou: HTTP ${resp.status}`);
  }
  return resp.json();
}

async function baixarPdf(id) {
  const resp = await fetch(`${API_URL}/api/etiquetas/${id}/pdf`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET /${id}/pdf falhou: HTTP ${resp.status}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const filePath = path.join(os.tmpdir(), `etiqueta-${id}.pdf`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

async function marcarConcluido(id) {
  await fetch(`${API_URL}/api/etiquetas/${id}/concluido`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
}

async function marcarErro(id, mensagem) {
  await fetch(`${API_URL}/api/etiquetas/${id}/erro`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ erro: String(mensagem).slice(0, 300) }),
  });
}

async function processarJob(job) {
  log(`Imprimindo etiqueta #${job.id} (caixa ${job.caixa_id}) em "${job.impressora}"...`);
  let filePath;
  try {
    filePath = await baixarPdf(job.id);
    // scale: "noscale" evita que o SumatraPDF tente "encaixar" o PDF de
    // 100x70mm em outro tamanho de página — a etiqueta já vem no tamanho
    // exato que a Argox espera.
    await print(filePath, {
      printer: job.impressora,
      silent: true,
      scale: 'noscale',
    });
    await marcarConcluido(job.id);
    log(`Etiqueta #${job.id} impressa com sucesso.`);
  } catch (err) {
    log(`ERRO ao imprimir etiqueta #${job.id}:`, err.message);
    await marcarErro(job.id, err.message).catch(() => {});
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
}

let processando = false;

async function ciclo() {
  if (processando) return; // evita sobrepor ciclos se um job demorar mais que o intervalo
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

log(`Agente de impressão iniciado. Consultando ${API_URL} a cada ${POLL_INTERVAL_MS / 1000}s.`);
ciclo();
setInterval(ciclo, POLL_INTERVAL_MS);
