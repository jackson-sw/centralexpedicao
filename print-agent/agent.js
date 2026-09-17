// Agente local de impressão — Central Expedição
//
// Roda neste computador (o "computador-ponte"), ligado por USB/rede às
// impressoras físicas: as duas Argox OS-214 Plus (etiqueta de caixa,
// uma do Almoxarifado/Produção — mesma fila — outra da Expedição) e
// uma impressora a laser comum (papel A4, romaneio das caixas do
// perfil Produção) — todas no MESMO computador. O backend fica na
// nuvem e não enxerga essas impressoras diretamente — por isso ele só
// ENFILEIRA os pedidos (tabelas etiqueta_fila e romaneio_impressao_fila);
// este agente é quem, de tempos em tempos, busca as filas, baixa o PDF
// já pronto e manda pra impressora certa.
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
  console.log(`[${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}]`, ...args);
}

// Duas filas independentes, consultadas no mesmo ciclo por este único
// agente/computador — cada uma com seu próprio endpoint no backend e
// suas próprias opções de impressão:
// - etiqueta: etiqueta da caixa (100x70mm, Argox). Precisa de
//   scale:"noscale" (a etiqueta já vem no tamanho exato, não deixa o
//   SumatraPDF "encaixar" em outro papel) e orientation:"landscape"
//   (o PDF é mais largo que alto).
// - romaneio: romaneio das caixas do perfil Produção (A4, impressora
//   a laser comum) — sem opções especiais, deixa o SumatraPDF ajustar
//   ao papel A4 configurado no driver da laser.
const FILAS = [
  {
    nome: 'etiqueta',
    base: '/api/etiquetas',
    printOptions: { scale: 'noscale', orientation: 'landscape' },
    descricaoJob: (job) => `etiqueta #${job.id} (caixa ${job.caixa_id})`,
  },
  {
    nome: 'romaneio',
    base: '/api/romaneio-impressao',
    printOptions: {},
    descricaoJob: (job) => `romaneio #${job.id} (caixa ${job.caixa_id})`,
  },
];

async function buscarPendentes(base) {
  const resp = await fetch(`${API_URL}${base}/pendentes`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET ${base}/pendentes falhou: HTTP ${resp.status}`);
  }
  return resp.json();
}

async function baixarPdf(base, id, prefixoArquivo) {
  const resp = await fetch(`${API_URL}${base}/${id}/pdf`, {
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
  if (!resp.ok) {
    throw new Error(`GET ${base}/${id}/pdf falhou: HTTP ${resp.status}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const filePath = path.join(os.tmpdir(), `${prefixoArquivo}-${id}.pdf`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

async function marcarConcluido(base, id) {
  await fetch(`${API_URL}${base}/${id}/concluido`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY },
  });
}

async function marcarErro(base, id, mensagem) {
  await fetch(`${API_URL}${base}/${id}/erro`, {
    method: 'POST',
    headers: { 'X-Agent-Key': AGENT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ erro: String(mensagem).slice(0, 300) }),
  });
}

async function processarJob(fila, job) {
  log(`Imprimindo ${fila.descricaoJob(job)} em "${job.impressora}"...`);
  let filePath;
  try {
    filePath = await baixarPdf(fila.base, job.id, fila.nome);
    await print(filePath, {
      printer: job.impressora,
      silent: true,
      ...fila.printOptions,
    });
    await marcarConcluido(fila.base, job.id);
    log(`${fila.nome} #${job.id} impresso(a) com sucesso.`);
  } catch (err) {
    log(`ERRO ao imprimir ${fila.nome} #${job.id}:`, err.message);
    await marcarErro(fila.base, job.id, err.message).catch(() => {});
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
}

let processando = false;

async function ciclo() {
  if (processando) return; // evita sobrepor ciclos se um job demorar mais que o intervalo
  processando = true;
  try {
    for (const fila of FILAS) {
      const pendentes = await buscarPendentes(fila.base);
      for (const job of pendentes) {
        await processarJob(fila, job);
      }
    }
  } catch (err) {
    log('ERRO ao consultar a fila:', err.message);
  } finally {
    processando = false;
  }
}

log(`Agente de impressão iniciado. Consultando ${API_URL} a cada ${POLL_INTERVAL_MS / 1000}s (filas: ${FILAS.map((f) => f.nome).join(', ')}).`);
ciclo();
setInterval(ciclo, POLL_INTERVAL_MS);
