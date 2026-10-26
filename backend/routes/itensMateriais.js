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
// terceira parte no final: projeto + hífen + estrutura (letras+número)
// + hífen + posição (ex.: "265545-DTV001-0463" → produto
// "265545-DTV001", posição "0463"). Esse código não é o PRO_Codigo
// direto — a posição identifica a linha específica dentro da ordem de
// produção (ORD_ORDEMPRVITEM), então a descrição/quantidade têm que
// vir de lá, não de PRO_PRODUTO isolado. Itens do catálogo "normal"
// (sem essa terceira parte) continuam batendo direto por PRO_Codigo,
// como sempre.
//
// O número do projeto normalmente tem 6 dígitos (ex.: "265545"), mas
// itens de REFORMA de uma estrutura já existente vêm com 8 dígitos:
// os 6 dígitos do projeto original + 2 dígitos do número da reforma
// (ex.: "19029901" = projeto "190299" + reforma "01" — o número da
// reforma não é sempre "01", só o tamanho é sempre 8 dígitos no total).
const PADRAO_CODIGO_COM_POSICAO = /^(\d{6}(?:\d{2})?-[A-Za-z]{3}\d+)-(\d+)$/;

// SELECT do item de estrutura pela ENGENHARIA (ENG_ESTRUTURAITEM) — caso 2
// abaixo. O código lido "250614-DTV001-463" vira produto "250614-DTV001"
// (o PAI, um subconjunto da estrutura) e posição 463; o item procurado é o
// FILHO desse pai que está na posição 463, na maior revisão (ENG_EstruturaNumero)
// do pai e do filho. Vêm daí Produto_Pai, Posicao_Filho e a descrição do
// filho (Descricao_Filho). Comando original em
// "comandos sql/Eng_busca_item_posicao.txt".
//
// A posição sai impressa no código de barras SEM os zeros à esquerda (o
// programa que gera a etiqueta os descarta), mas no ERP ela fica gravada com
// zeros à esquerda (ex.: código de barras "...-78", ERP "0078") — por isso a
// comparação da posição é numérica (TRY_CAST ... AS INT), que trata "78" e
// "0078" como o mesmo valor. TRY_CAST em vez de CAST: posição não-numérica
// vira NULL (só não bate) em vez de derrubar a consulta inteira.
const SELECT_POR_POSICAO = `
  SELECT TOP 1
    RTRIM(FILHO.ENG_EstruturaItemProduto)  AS codigo,
    RTRIM(PF.PRO_Descricao)                AS descricao,
    FILHO.ENG_EstruturaItemQuantidade * PAI.ENG_EstruturaItemQuantidade AS quantidade
  FROM ENG_ESTRUTURAITEM AS PAI
  INNER JOIN ENG_ESTRUTURAITEM AS FILHO
    ON FILHO.ENG_EstruturaProduto = PAI.ENG_EstruturaItemProduto
   AND FILHO.ENG_EstruturaNumero = (
        SELECT MAX(e2.ENG_EstruturaNumero)
        FROM ENG_ESTRUTURA AS e2
        WHERE e2.ENG_EstruturaProduto = FILHO.ENG_EstruturaProduto
   )
  INNER JOIN PRO_PRODUTO AS PF
    ON PF.PRO_Codigo = FILHO.ENG_EstruturaItemProduto
  WHERE RTRIM(PAI.ENG_EstruturaItemProduto) = @produto
    AND PAI.ENG_EstruturaNumero = (
        SELECT MAX(e2.ENG_EstruturaNumero)
        FROM ENG_ESTRUTURA AS e2
        WHERE e2.ENG_EstruturaProduto = PAI.ENG_EstruturaProduto
   )
    AND TRY_CAST(RTRIM(FILHO.ENG_EstruturaItemPosicao) AS INT) = TRY_CAST(@posicao AS INT)
`;

// Busca direta por PRO_Codigo (código "sem posição").
const SELECT_POR_CODIGO = `
  SELECT TOP 1
    RTRIM(PRO_Codigo)    AS codigo,
    RTRIM(PRO_Descricao) AS descricao,
    PRO_PesoLiquido       AS quantidade
  FROM PRO_PRODUTO
  WHERE RTRIM(PRO_Codigo) = @codigo
`;

// Dois casos de código com posição ("projeto-ESTRUTURA-posição"):
//  1) a "posição" é o próprio número da estrutura (ex.: 250614-EPE010-10:
//     estrutura EPE010 → 010 = 10): a etiqueta é do item "250614-EPE010"
//     em si, então descarta a posição e busca como código sem posição;
//  2) a posição NÃO é o número da estrutura (ex.: 265545-DTV001-463, e a
//     estrutura é DTV001 = 1): é a posição de um item dentro da estrutura,
//     busca na engenharia (SELECT_POR_POSICAO).
function posicaoEhDaEstrutura(produto, posicao) {
  const numeroEstrutura = /-[A-Za-z]{3}(\d+)$/.exec(produto);
  return !!numeroEstrutura && parseInt(numeroEstrutura[1], 10) === parseInt(posicao, 10);
}

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
// busca na engenharia (ENG_ESTRUTURAITEM pai/filho) pela posição — ou, se a
// posição for o próprio número da estrutura, direto por PRO_Codigo sem ela
// (ver posicaoEhDaEstrutura); caso contrário, busca por PRO_Codigo como sempre.
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const codigo = req.params.codigo.trim();
    const pool = await getPool();
    const request = pool.request();

    const comPosicao = PADRAO_CODIGO_COM_POSICAO.exec(codigo);
    let result;
    if (comPosicao && !posicaoEhDaEstrutura(comPosicao[1], comPosicao[2])) {
      // Caso 2: posição de um item dentro da estrutura (engenharia).
      const [, produto, posicao] = comPosicao;
      request.input('produto', sql.NVarChar, produto);
      request.input('posicao', sql.NVarChar, posicao);
      result = await request.query(SELECT_POR_POSICAO);
    } else {
      // Sem posição, ou caso 1 (posição = número da estrutura): busca por
      // PRO_Codigo, sem a posição.
      request.input('codigo', sql.NVarChar, comPosicao ? comPosicao[1] : codigo);
      result = await request.query(SELECT_POR_CODIGO);
    }

    const item = result.recordset[0];
    if (!item) return res.status(404).json({ erro: 'Item não encontrado no catálogo.' });
    res.json(item);
  } catch (err) {
    console.error('[GET /itens-materiais/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao consultar item no ERP.' });
  }
});

// GET /api/itens-materiais/pertence-projeto?codigo=...&projeto=... —
// usado no fluxo de Novo/Alterar Carregamento pra confirmar se um item
// cujo código NÃO carrega o número do projeto no próprio texto (ex.:
// "ACABRU-0001", diferente de "250013-DGA109" ou de uma reforma de 8
// dígitos "19029901-PET005") pertence mesmo à ordem de produção do
// projeto informado pelo usuário no carregamento. Sem essa consulta,
// o frontend não teria como comparar o código com o projeto — a
// comparação de texto (prefixo antes do hífen) só funciona quando o
// próprio código já carrega o número do projeto.
//
// TRY_CAST no projeto porque ORD_OrdemProjeto é numérico no ERP — evita
// que um valor não-numérico derrube a consulta (mesmo motivo do
// TRY_CAST em SELECT_POR_POSICAO acima).
router.get('/pertence-projeto', auth, async (req, res) => {
  try {
    const codigo = String(req.query.codigo || '').trim();
    const projeto = String(req.query.projeto || '').trim();
    if (!codigo || !projeto) {
      return res.status(400).json({ erro: 'Informe codigo e projeto.' });
    }

    const pool = await getPool();
    const request = pool.request();
    request.input('codigo', sql.NVarChar, codigo);
    request.input('projeto', sql.NVarChar, projeto);

    const result = await request.query(`
      SELECT TOP 1
        RTRIM(pp.PRO_Descricao)       AS descricao,
        oi.ORD_OrdemPrvItemQuantidade AS quantidade
      FROM ORD_ORDEM AS oo
      JOIN ORD_ORDEMPRVITEM AS oi
        ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
      JOIN PRO_PRODUTO AS pp
        ON pp.PRO_Codigo = oi.ORD_OrdemPrvItemProduto
      WHERE TRY_CAST(oo.ORD_OrdemProjeto AS BIGINT) = TRY_CAST(@projeto AS BIGINT)
        AND RTRIM(oi.ORD_OrdemPrvItemProduto) = @codigo
    `);

    const item = result.recordset[0];
    res.json({ pertence: !!item });
  } catch (err) {
    console.error('[GET /itens-materiais/pertence-projeto]', err.message);
    res.status(500).json({ erro: 'Erro ao consultar o ERP.' });
  }
});

module.exports = router;
