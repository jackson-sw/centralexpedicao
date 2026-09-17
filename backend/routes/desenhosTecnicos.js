const router = require('express').Router();
const db     = require('../db');

// Fila de busca + impressão automática do desenho técnico (PDF) de um
// item lido no romaneio de Produção — ver backend/routes/
// romaneiosProducao.js (quem enfileira, ao parsear o codigo_item) e
// desenho-agent/ (quem de fato busca o arquivo no servidor de
// arquivos on-premises e imprime, sem passar o PDF por aqui: o
// backend só registra o pedido e o resultado).

// Bloqueio: só o agente local (desenho-agent/, rodando na rede
// interna onde D:\Engenharia\... é visível) pode consultar/concluir
// esta fila — mesma chave fixa dos demais agentes (AGENT_API_KEY),
// fora do esquema de JWT dos perfis do app.
function apenasAgente(req, res, next) {
  const chave = req.headers['x-agent-key'];
  if (!process.env.AGENT_API_KEY || chave !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ erro: 'Chave do agente de impressão inválida ou não configurada.' });
  }
  next();
}

// GET /api/desenhos-tecnicos/pendentes — usado só pelo desenho-agent.
router.get('/pendentes', apenasAgente, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, romaneio_item_id, codigo_item, projeto, estrutura, criado_em
       FROM desenho_tecnico_impressao_fila
       WHERE status = 'pendente'
       ORDER BY criado_em ASC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /desenhos-tecnicos/pendentes]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar fila de desenhos técnicos.' });
  }
});

// POST /api/desenhos-tecnicos/:id/concluido — agente confirma que
// encontrou e imprimiu o desenho.
router.post('/:id/concluido', apenasAgente, async (req, res) => {
  try {
    await db.query(
      `UPDATE desenho_tecnico_impressao_fila SET status = 'impresso', concluido_em = NOW() WHERE id = ?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /desenhos-tecnicos/:id/concluido]', err.message);
    res.status(500).json({ erro: 'Erro ao concluir impressão do desenho.' });
  }
});

// POST /api/desenhos-tecnicos/:id/erro — agente reporta falha (pasta
// do projeto/estrutura não encontrada, arquivo não encontrado,
// ambíguo, impressora indisponível, etc.).
router.post('/:id/erro', apenasAgente, async (req, res) => {
  try {
    const msg = String(req.body?.erro || 'Erro desconhecido').slice(0, 300);
    await db.query(
      `UPDATE desenho_tecnico_impressao_fila SET status = 'erro', erro_msg = ? WHERE id = ?`,
      [msg, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /desenhos-tecnicos/:id/erro]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar falha do desenho.' });
  }
});

module.exports = router;
