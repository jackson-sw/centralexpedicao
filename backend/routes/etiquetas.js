const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');
const { gerarEtiquetaPDF } = require('../pdf/etiqueta');

// Só estes dois perfis têm impressora Argox configurada (uma cada,
// compartilhada por todo mundo logado naquele perfil — não há login
// por pessoa neste sistema). O nome vem do .env porque é o nome
// exato da fila de impressão no Windows do computador-ponte.
const IMPRESSORA_POR_PERFIL = {
  almoxarifado: process.env.IMPRESSORA_ALMOXARIFADO_NOME,
  expedicao:    process.env.IMPRESSORA_EXPEDICAO_NOME,
};

// Bloqueio: só o agente de impressão local (rodando no computador
// ligado às Argox) pode consultar/baixar/concluir a fila — ele não
// tem um login de perfil normal, autentica com uma chave fixa fora
// do esquema de JWT dos perfis do app.
function apenasAgente(req, res, next) {
  const chave = req.headers['x-agent-key'];
  if (!process.env.AGENT_API_KEY || chave !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ erro: 'Chave do agente de impressão inválida ou não configurada.' });
  }
  next();
}

// POST /api/etiquetas — enfileira a impressão da etiqueta de uma
// caixa já finalizada (perfis Almoxarifado e Expedição). O PDF em si
// só é gerado quando o agente local baixa o job (GET /:id/pdf),
// então esta rota é rápida — só grava a intenção na fila.
router.post('/', auth, async (req, res) => {
  try {
    const perfil = req.usuario?.perfil;
    const impressora = IMPRESSORA_POR_PERFIL[perfil];
    if (!impressora) {
      return res.status(403).json({ erro: 'Seu perfil não tem impressora de etiqueta configurada.' });
    }

    const { caixa_id } = req.body;
    if (!caixa_id) return res.status(400).json({ erro: 'caixa_id é obrigatório.' });

    const [[caixa]] = await db.query('SELECT id, codigo_barras FROM caixas WHERE id = ?', [caixa_id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (!caixa.codigo_barras) {
      return res.status(400).json({ erro: 'Esta caixa ainda não tem código de barras — finalize antes de imprimir.' });
    }

    const [result] = await db.query(
      `INSERT INTO etiqueta_fila (caixa_id, impressora, solicitado_por_perfil) VALUES (?, ?, ?)`,
      [caixa_id, impressora, perfil]
    );

    res.status(201).json({
      id: result.insertId,
      impressora,
      mensagem: `Etiqueta enviada para a impressora (${impressora}).`,
    });
  } catch (err) {
    console.error('[POST /etiquetas]', err.message);
    res.status(500).json({ erro: 'Erro ao enfileirar etiqueta.' });
  }
});

// GET /api/etiquetas/pendentes — usado só pelo agente local para
// saber o que falta imprimir. Devolve os jobs de todas as
// impressoras — o agente decide quais são "dele" pelo nome recebido
// em cada item (ele pode estar ligado a uma ou às duas Argox).
router.get('/pendentes', apenasAgente, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, caixa_id, impressora, criado_em
       FROM etiqueta_fila
       WHERE status = 'pendente'
       ORDER BY criado_em ASC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /etiquetas/pendentes]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar fila de etiquetas.' });
  }
});

// GET /api/etiquetas/:id/pdf — o agente baixa o PDF pronto (100mm x
// 70mm, com código de barras) pra mandar direto pra impressora.
router.get('/:id/pdf', apenasAgente, async (req, res) => {
  try {
    const [[job]] = await db.query('SELECT * FROM etiqueta_fila WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ erro: 'Job de impressão não encontrado.' });

    const [[caixa]] = await db.query('SELECT * FROM v_caixas_resumo WHERE id = ?', [job.caixa_id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });

    const pdfBuffer = await gerarEtiquetaPDF({ caixa });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="etiqueta-${caixa.codigo_barras || caixa.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[GET /etiquetas/:id/pdf]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar PDF da etiqueta.' });
  }
});

// POST /api/etiquetas/:id/concluido — agente confirma que imprimiu.
router.post('/:id/concluido', apenasAgente, async (req, res) => {
  try {
    await db.query(`UPDATE etiqueta_fila SET status = 'impresso', impresso_em = NOW() WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /etiquetas/:id/concluido]', err.message);
    res.status(500).json({ erro: 'Erro ao concluir etiqueta.' });
  }
});

// POST /api/etiquetas/:id/erro — agente reporta falha (impressora
// desligada, sem papel, etc.) — fica registrado pra investigar depois
// em vez de ficar tentando pra sempre em silêncio.
router.post('/:id/erro', apenasAgente, async (req, res) => {
  try {
    const msg = String(req.body?.erro || 'Erro desconhecido').slice(0, 300);
    await db.query(`UPDATE etiqueta_fila SET status = 'erro', erro_msg = ? WHERE id = ?`, [msg, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /etiquetas/:id/erro]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar falha da etiqueta.' });
  }
});

module.exports = router;
