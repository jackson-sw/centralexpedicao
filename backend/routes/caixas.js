const router = require('express').Router();
const db     = require('../db');
const { auth, apenasAlmoxarifado } = require('../middleware/auth');

// GET /api/caixas — histórico (mais recentes primeiro)
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM v_caixas_resumo WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY criado_em DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[GET /caixas]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixas.' });
  }
});

// GET /api/caixas/codigo/:codigo — busca por código de barras
// Usado pelo scanner do "Novo Carregamento" para expandir os
// itens da caixa automaticamente ao ler o código dela.
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const [[caixa]] = await db.query(
      'SELECT * FROM v_caixas_resumo WHERE codigo_barras = ?',
      [req.params.codigo]
    );
    if (!caixa) return res.status(404).json({ erro: 'Nenhuma caixa encontrada com esse código.' });

    const [itens] = await db.query(
      'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
      [caixa.id]
    );

    res.json({ ...caixa, itens });
  } catch (err) {
    console.error('[GET /caixas/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixa.' });
  }
});

// GET /api/caixas/:id — detalhe com itens
router.get('/:id', auth, async (req, res) => {
  try {
    const [[caixa]] = await db.query(
      'SELECT * FROM v_caixas_resumo WHERE id = ?',
      [req.params.id]
    );
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });

    const [itens] = await db.query(
      'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
      [req.params.id]
    );

    res.json({ ...caixa, itens });
  } catch (err) {
    console.error('[GET /caixas/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixa.' });
  }
});

// POST /api/caixas — montar e fechar uma nova caixa (Almoxarifado)
// Ao ser salva, a caixa já nasce "fechada" e ganha um código de
// barras próprio (CX + id com zero à esquerda), pronto para
// impressão da etiqueta.
router.post('/', auth, apenasAlmoxarifado, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { responsavel_nome, observacoes, itens } = req.body;

    if (!responsavel_nome) {
      conn.release();
      return res.status(400).json({ erro: 'Campo obrigatório: responsavel_nome.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      conn.release();
      return res.status(400).json({ erro: 'Inclua ao menos um item na caixa.' });
    }
    for (const item of itens) {
      if (!item.codigo_item || !item.descricao || !item.quantidade) {
        conn.release();
        return res.status(400).json({ erro: 'Cada item precisa de código, descrição e quantidade.' });
      }
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO caixas (responsavel_nome, observacoes, criado_por_perfil)
       VALUES (?, ?, ?)`,
      [responsavel_nome, observacoes || null, req.usuario.perfil]
    );

    const caixaId = result.insertId;
    const codigoBarras = 'CX' + String(caixaId).padStart(6, '0');

    await conn.query('UPDATE caixas SET codigo_barras = ? WHERE id = ?', [codigoBarras, caixaId]);

    for (let i = 0; i < itens.length; i++) {
      await conn.query(
        `INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, ordem)
         VALUES (?, ?, ?, ?, ?)`,
        [caixaId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, i + 1]
      );
    }

    await conn.commit();
    res.status(201).json({ id: caixaId, codigo_barras: codigoBarras, mensagem: 'Caixa fechada com sucesso.' });
  } catch (err) {
    await conn.rollback();
    console.error('[POST /caixas]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar caixa.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
