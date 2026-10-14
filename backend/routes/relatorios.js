const router = require('express').Router();
const db = require('../db');
const { sql, getPool } = require('../dbErp');
const { auth } = require('../middleware/auth');
const { calcularFaltantes } = require('../relatorioEstrutura');

// Relatórios — perfis Expedição, Almoxarifado e Expedição Administrativo
// (mesmos que veem a guia "Relatórios" no frontend).
const PERFIS_PERMITIDOS = ['expedicao', 'almoxarifado', 'expedicao_administrativo', 'consulta'];

function apenasPerfisDeRelatorio(req, res, next) {
  if (!PERFIS_PERMITIDOS.includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Acesso restrito aos perfis Expedição, Almoxarifado e Expedição Administrativo.' });
  }
  next();
}

// Projeto: 6 dígitos, ou 8 de reforma (6 do original + 2 da reforma).
// Estrutura: 3 letras + número (ex.: TCA100).
const PADRAO_PROJETO = /^\d{6}(?:\d{2})?$/;
const PADRAO_ESTRUTURA = /^[A-Za-z]{3}\d+$/;

// Itens da estrutura no ERP — mesma consulta usada em outros pontos do
// sistema (ORD_ORDEM + ORD_ORDEMPRVITEM + PRO_PRODUTO), filtrando pela
// coluna ORD_OrdemProduto ("projeto-estrutura", ex.: 250614-TCA100) com
// LIKE, como definido pelo usuário. O valor já foi validado pelos
// padrões acima (só dígitos/letras), então não há curinga indevido.
const SELECT_ITENS_ESTRUTURA = `
  SELECT
    RTRIM(oo.ORD_OrdemProduto)         AS ordem_produto,
    RTRIM(oi.ORD_OrdemPrvItemProduto)  AS codigo,
    RTRIM(pp.PRO_Descricao)            AS descricao,
    oi.ORD_OrdemPrvItemQuantidade      AS quantidade,
    RTRIM(oi.ORD_OrdemPrvItemPosicao)  AS posicao
  FROM ORD_ORDEM AS oo
  JOIN ORD_ORDEMPRVITEM AS oi
    ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
  JOIN PRO_PRODUTO AS pp
    ON pp.PRO_Codigo = oi.ORD_OrdemPrvItemProduto
  WHERE oo.ORD_OrdemProduto LIKE @chave
`;

// Tudo que já foi carregado nos carregamentos do projeto (um projeto pode
// ter vários carregamentos; os cancelados não contam):
//  - itens avulsos, e itens "expandidos" de formato antigo (caixa_item_id
//    preenchido) — contam eles mesmos;
//  - caixa inteira (caixa_id preenchido, sem caixa_item_id — formato
//    atual): a linha do carregamento é só "Caixa contendo itens", então
//    o que saiu de fato são os itens da caixa (caixa_itens).
const SELECT_CARREGADOS = `
  SELECT ci.codigo_item, ci.quantidade
  FROM carregamento_itens ci
  JOIN carregamentos cg ON cg.id = ci.carregamento_id
  WHERE cg.numero_projeto = ?
    AND cg.status <> 'cancelado'
    AND (ci.caixa_id IS NULL OR ci.caixa_item_id IS NOT NULL)

  UNION ALL

  SELECT cxi.codigo_item, cxi.quantidade
  FROM caixa_itens cxi
  WHERE cxi.caixa_id IN (
    SELECT DISTINCT ci2.caixa_id
    FROM carregamento_itens ci2
    JOIN carregamentos cg2 ON cg2.id = ci2.carregamento_id
    WHERE cg2.numero_projeto = ?
      AND cg2.status <> 'cancelado'
      AND ci2.caixa_id IS NOT NULL
      AND ci2.caixa_item_id IS NULL
  )
`;

// GET /api/relatorios/estrutura-faltantes?projeto=250614&estrutura=TCA100
router.get('/estrutura-faltantes', auth, apenasPerfisDeRelatorio, async (req, res) => {
  const projeto = String(req.query.projeto || '').trim();
  const estrutura = String(req.query.estrutura || '').trim().toUpperCase();

  if (!PADRAO_PROJETO.test(projeto)) {
    return res.status(400).json({ erro: 'Informe o número do projeto com 6 dígitos (ou 8, se for reforma).' });
  }
  if (!PADRAO_ESTRUTURA.test(estrutura)) {
    return res.status(400).json({ erro: 'Informe o código da estrutura (3 letras + número, ex.: TCA100).' });
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('chave', sql.NVarChar, `%${projeto}-${estrutura}%`);
    const { recordset: itensErp } = await request.query(SELECT_ITENS_ESTRUTURA);

    if (!itensErp.length) {
      return res.status(404).json({ erro: `Nenhum item encontrado no ERP para ${projeto}-${estrutura}.` });
    }

    const [carregados] = await db.query(SELECT_CARREGADOS, [projeto, projeto]);
    const { itens, resumo } = calcularFaltantes(itensErp, carregados);

    res.json({ projeto, estrutura, resumo, itens });
  } catch (err) {
    console.error('[GET /relatorios/estrutura-faltantes]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar o relatório.' });
  }
});

module.exports = router;
