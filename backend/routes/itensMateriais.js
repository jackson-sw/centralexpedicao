const router = require('express').Router();
const db     = require('../db');
const { auth, apenasAdmin } = require('../middleware/auth');

// GET /api/itens-materiais — lista completa (painel admin)
router.get('/', auth, apenasAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM itens_materiais ORDER BY codigo ASC');
    res.json(rows);
  } catch (err) {
    console.error('[GET /itens-materiais]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar itens.' });
  }
});

// GET /api/itens-materiais/codigo/:codigo — busca por código exato.
// Usado para auto-preencher a Descrição ao digitar/escanear o código
// do item em Novo Carregamento / Nova Caixa / Alterar Caixa — por isso
// qualquer perfil autenticado pode consultar (não é exclusivo do admin).
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const [[item]] = await db.query(
      'SELECT codigo, descricao, quantidade FROM itens_materiais WHERE codigo = ?',
      [req.params.codigo]
    );
    if (!item) return res.status(404).json({ erro: 'Item não encontrado no catálogo.' });
    res.json(item);
  } catch (err) {
    console.error('[GET /itens-materiais/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar item.' });
  }
});

// GET /api/itens-materiais/:id
router.get('/:id', auth, apenasAdmin, async (req, res) => {
  try {
    const [[item]] = await db.query('SELECT * FROM itens_materiais WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json(item);
  } catch (err) {
    console.error('[GET /itens-materiais/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar item.' });
  }
});

// POST /api/itens-materiais — cadastrar novo item
router.post('/', auth, apenasAdmin, async (req, res) => {
  try {
    const codigo     = (req.body.codigo    || '').trim();
    const descricao  = (req.body.descricao || '').trim();
    const quantidade = parseFloat(req.body.quantidade);

    if (!codigo || !descricao) {
      return res.status(400).json({ erro: 'Campos obrigatórios: código e descrição.' });
    }
    if (!Number.isFinite(quantidade) || quantidade < 0) {
      return res.status(400).json({ erro: 'Quantidade inválida.' });
    }

    const [result] = await db.query(
      'INSERT INTO itens_materiais (codigo, descricao, quantidade) VALUES (?, ?, ?)',
      [codigo, descricao, quantidade]
    );
    res.status(201).json({ id: result.insertId, codigo, descricao, quantidade, mensagem: 'Item cadastrado com sucesso.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Já existe um item cadastrado com esse código.' });
    }
    console.error('[POST /itens-materiais]', err.message);
    res.status(500).json({ erro: 'Erro ao cadastrar item.' });
  }
});

// PUT /api/itens-materiais/:id — editar item existente
router.put('/:id', auth, apenasAdmin, async (req, res) => {
  try {
    const codigo     = (req.body.codigo    || '').trim();
    const descricao  = (req.body.descricao || '').trim();
    const quantidade = parseFloat(req.body.quantidade);

    if (!codigo || !descricao) {
      return res.status(400).json({ erro: 'Campos obrigatórios: código e descrição.' });
    }
    if (!Number.isFinite(quantidade) || quantidade < 0) {
      return res.status(400).json({ erro: 'Quantidade inválida.' });
    }

    const [result] = await db.query(
      'UPDATE itens_materiais SET codigo = ?, descricao = ?, quantidade = ? WHERE id = ?',
      [codigo, descricao, quantidade, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json({ mensagem: 'Item atualizado com sucesso.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Já existe um item cadastrado com esse código.' });
    }
    console.error('[PUT /itens-materiais/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar item.' });
  }
});

// DELETE /api/itens-materiais/:id — remover item
router.delete('/:id', auth, apenasAdmin, async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM itens_materiais WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json({ mensagem: 'Item removido com sucesso.' });
  } catch (err) {
    console.error('[DELETE /itens-materiais/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao remover item.' });
  }
});

module.exports = router;
