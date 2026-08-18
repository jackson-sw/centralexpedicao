const router = require('express').Router();
const { sql, getPool } = require('../dbErp');
const { auth, apenasAdmin } = require('../middleware/auth');

// Catálogo de itens/materiais — lido em tempo real do ERP (SQL Server,
// tabela PRO_PRODUTO). Não existe mais cadastro próprio desta aplicação:
// o item é criado/editado/excluído direto no ERP, fora daqui. RTRIM nas
// colunas porque, em muitos ERPs, PRO_Codigo/PRO_Descricao são CHAR de
// tamanho fixo e vêm preenchidos com espaços à direita.
const SELECT_BASE = `
  SELECT
    RTRIM(PRO_Codigo)    AS codigo,
    RTRIM(PRO_Descricao) AS descricao,
    PRO_PesoLiquido       AS quantidade
  FROM PRO_PRODUTO
`;

// GET /api/itens-materiais — usado pelo painel admin (somente consulta).
// ?busca=texto filtra por código ou descrição (contém). Sem busca, traz
// os primeiros 100 itens só pra não tentar carregar a tabela inteira do
// ERP de uma vez — o catálogo real pode ter milhares de produtos.
router.get('/', auth, apenasAdmin, async (req, res) => {
  try {
    const busca = (req.query.busca || '').trim();
    const pool = await getPool();
    const request = pool.request();

    let query = SELECT_BASE;
    if (busca) {
      request.input('busca', sql.NVarChar, `%${busca}%`);
      query += ' WHERE PRO_Codigo LIKE @busca OR PRO_Descricao LIKE @busca';
    }
    query += ' ORDER BY PRO_Descricao';
    query = query.replace('SELECT', `SELECT TOP ${busca ? 200 : 100}`);

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('[GET /itens-materiais]', err.message);
    res.status(500).json({ erro: 'Erro ao consultar o catálogo no ERP.' });
  }
});

// GET /api/itens-materiais/codigo/:codigo — busca por código exato.
// Usado para auto-preencher a Descrição ao digitar/escanear o código
// do item em Novo Carregamento / Nova Caixa / Alterar Caixa — por isso
// qualquer perfil autenticado pode consultar (não é exclusivo do admin).
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('codigo', sql.NVarChar, req.params.codigo.trim());

    const result = await request.query(
      `SELECT TOP 1
         RTRIM(PRO_Codigo)    AS codigo,
         RTRIM(PRO_Descricao) AS descricao,
         PRO_PesoLiquido       AS quantidade
       FROM PRO_PRODUTO
       WHERE RTRIM(PRO_Codigo) = @codigo`
    );

    const item = result.recordset[0];
    if (!item) return res.status(404).json({ erro: 'Item não encontrado no catálogo.' });
    res.json(item);
  } catch (err) {
    console.error('[GET /itens-materiais/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao consultar item no ERP.' });
  }
});

module.exports = router;
