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

// Novo formato de etiqueta de item de estrutura de engenharia, com uma
// terceira parte no final: projeto (6 dígitos) + hífen + estrutura
// (letras+número) + hífen + posição (ex.: "265545-DTV001-0463" →
// produto "265545-DTV001", posição "0463"). Esse código não é o
// PRO_Codigo direto — a posição identifica a linha específica dentro
// da ordem de produção (ORD_ORDEMPRVITEM), então a descrição/
// quantidade têm que vir de lá, não de PRO_PRODUTO isolado. Itens do
// catálogo "normal" (sem essa terceira parte) continuam batendo direto
// por PRO_Codigo, como sempre.
const PADRAO_CODIGO_COM_POSICAO = /^(\d{6}-[A-Za-z]{3}\d+)-(\d+)$/;

// SELECT do item de estrutura pela ordem de produção (ORD_ORDEM) +
// posição (ORD_ORDEMPRVITEM), trazendo a descrição do produto em
// PRO_PRODUTO — fornecido pelo usuário. RTRIM nas colunas de junção
// pelo mesmo motivo do SELECT_BASE (CHAR de tamanho fixo no ERP).
//
// A posição sai impressa no código de barras SEM os zeros à esquerda
// (o programa que gera a etiqueta os descarta), mas no ERP ela fica
// gravada com zeros à esquerda (ex.: código de barras "...-78", ERP
// "0078") — comparar como texto (RTRIM = @posicao) não bate. Por isso
// a comparação da posição é numérica (TRY_CAST ... AS INT), que trata
// "78" e "0078" como o mesmo valor. TRY_CAST em vez de CAST porque,
// se algum registro tiver posição não-numérica, vira NULL em vez de
// dar erro na consulta inteira — só não bate, como esperado.
const SELECT_POR_POSICAO = `
  SELECT TOP 1
    RTRIM(oo.ORD_OrdemNumero)         AS codigo,
    RTRIM(pp.PRO_Descricao)           AS descricao,
    oi.ORD_OrdemPrvItemQuantidade     AS quantidade
  FROM ORD_ORDEM AS oo
  JOIN ORD_ORDEMPRVITEM AS oi
    ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
  JOIN PRO_PRODUTO AS pp
    ON pp.PRO_Codigo = oi.ORD_OrdemPrvItemProduto
  WHERE RTRIM(oo.ORD_OrdemProduto) = @produto
    AND TRY_CAST(RTRIM(oi.ORD_OrdemPrvItemPosicao) AS INT) = TRY_CAST(@posicao AS INT)
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
// Se o código bater com o padrão projeto-estrutura-posição (etiqueta
// de item de estrutura de engenharia, ver PADRAO_CODIGO_COM_POSICAO),
// busca via ORD_ORDEM/ORD_ORDEMPRVITEM; caso contrário, busca direto
// por PRO_Codigo como sempre.
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const codigo = req.params.codigo.trim();
    const pool = await getPool();
    const request = pool.request();

    const comPosicao = PADRAO_CODIGO_COM_POSICAO.exec(codigo);
    let result;
    if (comPosicao) {
      const [, produto, posicao] = comPosicao;
      request.input('produto', sql.NVarChar, produto);
      request.input('posicao', sql.NVarChar, posicao);
      result = await request.query(SELECT_POR_POSICAO);
    } else {
      request.input('codigo', sql.NVarChar, codigo);
      result = await request.query(
        `SELECT TOP 1
           RTRIM(PRO_Codigo)    AS codigo,
           RTRIM(PRO_Descricao) AS descricao,
           PRO_PesoLiquido       AS quantidade
         FROM PRO_PRODUTO
         WHERE RTRIM(PRO_Codigo) = @codigo`
      );
    }

    const item = result.recordset[0];
    if (!item) return res.status(404).json({ erro: 'Item não encontrado no catálogo.' });
    res.json(item);
  } catch (err) {
    console.error('[GET /itens-materiais/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao consultar item no ERP.' });
  }
});

module.exports = router;
