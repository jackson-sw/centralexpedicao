const router = require('express').Router();
const db     = require('../db');
const { montarPdfRomaneioProducao } = require('../services/romaneioProducao');

// Fila de impressão automática do romaneio de Produção numa impressora
// a laser (papel A4) — não confundir com backend/routes/etiquetas.js
// (etiqueta da caixa, Argox, 100x70mm). Roda no MESMO computador-ponte
// do perfil Almoxarifado (ver print-agent/), só que numa impressora
// diferente (IMPRESSORA_ROMANEIO_NOME). O job é criado automaticamente
// dentro de POST /api/romaneios-producao/:id/romaneio, junto com o
// envio por e-mail — não existe uma rota pública pra enfileirar aqui.

// Bloqueio: só o agente de impressão local (o mesmo de
// backend/routes/etiquetas.js, rodando no computador-ponte) pode
// consultar/baixar/concluir esta fila — autentica com a mesma chave
// fixa (AGENT_API_KEY), fora do esquema de JWT dos perfis do app.
function apenasAgente(req, res, next) {
  const chave = req.headers['x-agent-key'];
  if (!process.env.AGENT_API_KEY || chave !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ erro: 'Chave do agente de impressão inválida ou não configurada.' });
  }
  next();
}

// GET /api/romaneio-impressao/pendentes — usado só pelo agente local.
router.get('/pendentes', apenasAgente, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, romaneio_id, impressora, criado_em
       FROM romaneio_producao_impressao_fila
       WHERE status = 'pendente'
       ORDER BY criado_em ASC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /romaneio-impressao/pendentes]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar fila de impressão de romaneio.' });
  }
});

// GET /api/romaneio-impressao/:id/pdf — o agente baixa o PDF do
// romaneio (A4) pra mandar direto pra impressora a laser.
router.get('/:id/pdf', apenasAgente, async (req, res) => {
  try {
    const [[job]] = await db.query('SELECT * FROM romaneio_producao_impressao_fila WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ erro: 'Job de impressão não encontrado.' });

    const dados = await montarPdfRomaneioProducao(job.romaneio_id);
    if (!dados) return res.status(404).json({ erro: 'Romaneio não encontrado.' });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="romaneio-${dados.romaneio.codigo || dados.romaneio.id}.pdf"`);
    res.send(dados.pdfBuffer);
  } catch (err) {
    console.error('[GET /romaneio-impressao/:id/pdf]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar PDF do romaneio.' });
  }
});

// POST /api/romaneio-impressao/:id/concluido — agente confirma que imprimiu.
router.post('/:id/concluido', apenasAgente, async (req, res) => {
  try {
    await db.query(`UPDATE romaneio_producao_impressao_fila SET status = 'impresso', impresso_em = NOW() WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /romaneio-impressao/:id/concluido]', err.message);
    res.status(500).json({ erro: 'Erro ao concluir impressão.' });
  }
});

// POST /api/romaneio-impressao/:id/erro — agente reporta falha
// (impressora desligada, sem papel, etc.).
router.post('/:id/erro', apenasAgente, async (req, res) => {
  try {
    const msg = String(req.body?.erro || 'Erro desconhecido').slice(0, 300);
    await db.query(`UPDATE romaneio_producao_impressao_fila SET status = 'erro', erro_msg = ? WHERE id = ?`, [msg, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /romaneio-impressao/:id/erro]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar falha de impressão.' });
  }
});

module.exports = router;
