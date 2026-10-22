const router = require('express').Router();
const db = require('../db');
const { sql, getPool } = require('../dbErp');
const { auth } = require('../middleware/auth');
const { calcularFaltantes, calcularFaltantesProjeto } = require('../relatorioEstrutura');
const { gerarRelatorioEstruturaPDF } = require('../pdf/relatorioEstrutura');

// ?formato=pdf devolve o relatório em PDF (download) em vez de JSON;
// ?todos=1 inclui também os itens já completos (padrão: só os com falta).
function querPdf(req) { return String(req.query.formato || '').toLowerCase() === 'pdf'; }
function querTodos(req) { return ['1', 'true'].includes(String(req.query.todos || '').toLowerCase()); }

function enviarPdf(res, buffer, nomeArquivo) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.send(buffer);
}

// Relatórios — perfis Expedição, Almoxarifado e Expedição Administrativo
// (mesmos que veem a guia "Relatórios" no frontend).
const PERFIS_PERMITIDOS = ['expedicao', 'almoxarifado', 'expedicao_administrativo', 'consulta'];

function apenasPerfisDeRelatorio(req, res, next) {
  if (!PERFIS_PERMITIDOS.includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Acesso restrito aos perfis Expedição, Almoxarifado e Expedição Administrativo.' });
  }
  next();
}

// O relatório "de itens faltantes para envio" (por enquanto) só é liberado
// para Almoxarifado e Expedição Administrativo (o perfil consulta, de
// leitura, também — ver README).
const PERFIS_FALTANTES = ['almoxarifado', 'expedicao_administrativo', 'consulta'];

function apenasPerfisDeFaltantes(req, res, next) {
  if (!PERFIS_FALTANTES.includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Este relatório está disponível apenas para os perfis Almoxarifado e Expedição Administrativo.' });
  }
  next();
}

// Projeto: 6 dígitos, ou 8 de reforma (6 do original + 2 da reforma).
// Estrutura (relatório de faltantes): só as 3 letras do tipo (ex.: EPE) —
// pega todas as estruturas do projeto que começam com elas (EPE010, EPE020...).
const PADRAO_PROJETO = /^\d{6}(?:\d{2})?$/;
const PADRAO_ESTRUTURA = /^[A-Za-z]{3}$/;

// Itens (e quantidades) que as estruturas precisam, vindos da ENGENHARIA
// (ENG_ESTRUTURAITEM + PRO_PRODUTO) — comando em
// "comandos sql/Eng_itens_faltantes.txt". @chave = "projeto-ESTRUTURA%"
// (ex.: 250614-EPE%), já validado (só dígitos/letras).
//  - só a MAIOR revisão (ENG_EstruturaNumero) de cada estrutura;
//  - descarta as letras C, M, S e T (ENG_EstruturaItemLetra);
//  - descarta itens que têm estrutura própria (subconjuntos): o que conta
//    são os componentes deles, não o subconjunto em si;
//  - a quantidade é SOMADA por item (ENG_EstruturaItemProduto), somando
//    também entre as várias estruturas que casam com as 3 letras.
const SELECT_ITENS_ESTRUTURA = `
  SELECT
    RTRIM(ei.ENG_EstruturaItemProduto)      AS codigo,
    RTRIM(p.PRO_Descricao)                  AS descricao,
    MAX(RTRIM(ei.ENG_EstruturaItemDimUnd))  AS und,
    SUM(ei.ENG_EstruturaItemQuantidade)     AS quantidade
  FROM ENG_ESTRUTURAITEM AS ei
  JOIN PRO_PRODUTO AS p
    ON p.PRO_Codigo = ei.ENG_EstruturaItemProduto
  WHERE ei.ENG_EstruturaProduto LIKE @chave
    AND ei.ENG_EstruturaItemLetra NOT IN ('C', 'M', 'S', 'T')
    AND ei.ENG_EstruturaNumero = (
      SELECT MAX(e2.ENG_EstruturaNumero)
      FROM ENG_ESTRUTURAITEM AS e2
      WHERE e2.ENG_EstruturaProduto = ei.ENG_EstruturaProduto
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ENG_ESTRUTURA AS es
      WHERE es.ENG_EstruturaProduto = ei.ENG_EstruturaItemProduto
    )
  GROUP BY RTRIM(ei.ENG_EstruturaItemProduto), RTRIM(p.PRO_Descricao)
`;

// Posição de cada item na ordem de produção (ORD_ORDEM + ORD_ORDEMPRVITEM).
// Serve só para associar etiquetas no formato "projeto-estrutura-posição"
// (ex.: 250614-TCA100-0078, que não traz o código do item) ao item
// certo da estrutura — as quantidades vêm da engenharia, acima.
const SELECT_POSICOES = `
  SELECT
    RTRIM(oo.ORD_OrdemProduto)         AS ordem_produto,
    RTRIM(oi.ORD_OrdemPrvItemProduto)  AS codigo,
    RTRIM(oi.ORD_OrdemPrvItemPosicao)  AS posicao
  FROM ORD_ORDEM AS oo
  JOIN ORD_ORDEMPRVITEM AS oi
    ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
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

// Caixas montadas pelo ALMOXARIFADO e já fechadas no projeto — é o que o
// relatório "de itens faltantes [Almoxarifado]" compara com a estrutura:
//  - só caixas criadas pelo perfil Almoxarifado (criado_por_perfil; as de
//    Produção e Expedição ficam de fora);
//  - "fechada" ou "expedida" (uma caixa expedida continua sendo uma caixa
//    fechada que o Almoxarifado montou); caixas abertas ainda não contam;
//  - o que vale são os itens dentro delas (caixa_itens).
const SELECT_CAIXAS_ALMOXARIFADO = `
  SELECT cxi.codigo_item, cxi.quantidade
  FROM caixa_itens cxi
  JOIN caixas cx ON cx.id = cxi.caixa_id
  WHERE cx.numero_projeto = ?
    AND cx.criado_por_perfil = 'almoxarifado'
    AND cx.status IN ('fechada', 'expedida')
`;

// Núcleo dos relatórios "itens faltantes": itens da estrutura (ERP) x o que
// já está em outro lugar (carregamentos ou caixas do Almoxarifado).
// `fonte` define de onde vem o "carregado":
//   { rotulo, titulo, arquivo, consulta, params(projeto), nome }
function responderFaltantes(fonte) {
  return async (req, res) => {
    const projeto = String(req.query.projeto || '').trim();
    const estrutura = String(req.query.estrutura || '').trim().toUpperCase();

    if (!PADRAO_PROJETO.test(projeto)) {
      return res.status(400).json({ erro: 'Informe o número do projeto com 6 dígitos (ou 8, se for reforma).' });
    }
    if (!PADRAO_ESTRUTURA.test(estrutura)) {
      return res.status(400).json({ erro: 'Informe a estrutura com 3 letras (ex.: EPE).' });
    }

    try {
      const pool = await getPool();
      const chave = `${projeto}-${estrutura}%`;
      const { recordset: itensErp } = await pool.request()
        .input('chave', sql.NVarChar, chave)
        .query(SELECT_ITENS_ESTRUTURA);

      if (!itensErp.length) {
        return res.status(404).json({ erro: `Nenhum item encontrado no ERP para ${projeto}-${estrutura}*.` });
      }

      const { recordset: posicoes } = await pool.request()
        .input('chave', sql.NVarChar, chave)
        .query(SELECT_POSICOES);

      const [carregados] = await db.query(fonte.consulta, fonte.params(projeto));
      const { itens, resumo } = calcularFaltantes(itensErp, carregados, posicoes);

      if (querPdf(req)) {
        const todos = querTodos(req);
        const pdf = await gerarRelatorioEstruturaPDF({
          titulo: fonte.titulo,
          rotuloCarregado: fonte.rotuloCarregado,
          projeto,
          resumo: `${projeto}-${estrutura}: ${resumo.total} ${resumo.total === 1 ? 'item' : 'itens'} na estrutura · ${resumo.com_falta} com falta · ${resumo.completos} completos`,
          semFalta: resumo.com_falta === 0,
          mostrarTodos: todos,
          grupos: [{ titulo: `${projeto}-${estrutura}`, itens: todos ? itens : itens.filter((i) => i.faltante > 0) }],
        });
        return enviarPdf(res, pdf, `${fonte.arquivo}-${projeto}-${estrutura}.pdf`);
      }

      res.json({ projeto, estrutura, resumo, itens });
    } catch (err) {
      console.error(`[GET /relatorios/${fonte.nome}]`, err.message);
      res.status(500).json({ erro: 'Erro ao gerar o relatório.' });
    }
  };
}

// GET /api/relatorios/estrutura-faltantes?projeto=250614&estrutura=EPE
// Itens faltantes para ENVIO: estrutura x carregamentos do projeto.
router.get('/estrutura-faltantes', auth, apenasPerfisDeFaltantes, responderFaltantes({
  nome: 'estrutura-faltantes',
  titulo: 'ITENS FALTANTES PARA ENVIO',
  rotuloCarregado: 'CARREGADO',
  arquivo: 'estrutura-faltantes',
  consulta: SELECT_CARREGADOS,
  params: (projeto) => [projeto, projeto],
}));

// GET /api/relatorios/itens-faltantes-almoxarifado?projeto=250614&estrutura=EPE
// Itens faltantes [Almoxarifado]: estrutura x caixas fechadas do Almoxarifado.
router.get('/itens-faltantes-almoxarifado', auth, apenasPerfisDeFaltantes, responderFaltantes({
  nome: 'itens-faltantes-almoxarifado',
  titulo: 'ITENS FALTANTES [ALMOXARIFADO]',
  rotuloCarregado: 'EM CAIXAS',
  arquivo: 'itens-faltantes-almoxarifado',
  consulta: SELECT_CAIXAS_ALMOXARIFADO,
  params: (projeto) => [projeto],
}));

// ── Relatório de estrutura (projeto inteiro) ─────────────────
// Mesmo processo do relatório de itens faltantes, mas para TODAS as
// estruturas do projeto (só o número do projeto é informado).

// Estruturas do projeto (ENG_ESTRUTURA), só a maior revisão de cada uma
// — comando em "comandos sql/Eng_estruturacompleta.txt".
const SELECT_ESTRUTURAS_PROJETO = `
  SELECT
    RTRIM(ees.ENG_EstruturaProduto)    AS codigo,
    ees.ENG_EstruturaNumero            AS numero,
    RTRIM(ees.ENG_EstruturaDescricao)  AS descricao
  FROM ENG_ESTRUTURA AS ees
  WHERE ees.ENG_EstruturaProjeto = @projeto
    AND ees.ENG_EstruturaNumero = (
      SELECT MAX(e2.ENG_EstruturaNumero)
      FROM ENG_ESTRUTURA AS e2
      WHERE e2.ENG_EstruturaProduto = ees.ENG_EstruturaProduto
    )
`;

// Itens de todas essas estruturas de uma vez (em vez de uma consulta por
// estrutura): ENG_ESTRUTURAITEM pelo código da estrutura E pela mesma
// revisão, + descrição em PRO_PRODUTO. Quantidade somada por item.
const SELECT_ITENS_ESTRUTURAS_PROJETO = `
  SELECT
    RTRIM(ees.ENG_EstruturaProduto)         AS estrutura,
    RTRIM(ei.ENG_EstruturaItemProduto)      AS codigo,
    RTRIM(pp.PRO_Descricao)                 AS descricao,
    MAX(RTRIM(ei.ENG_EstruturaItemDimUnd))  AS und,
    SUM(ei.ENG_EstruturaItemQuantidade)     AS quantidade
  FROM ENG_ESTRUTURA AS ees
  JOIN ENG_ESTRUTURAITEM AS ei
    ON ei.ENG_EstruturaProduto = ees.ENG_EstruturaProduto
   AND ei.ENG_EstruturaNumero  = ees.ENG_EstruturaNumero
  JOIN PRO_PRODUTO AS pp
    ON pp.PRO_Codigo = ei.ENG_EstruturaItemProduto
  WHERE ees.ENG_EstruturaProjeto = @projeto
    AND ees.ENG_EstruturaNumero = (
      SELECT MAX(e2.ENG_EstruturaNumero)
      FROM ENG_ESTRUTURA AS e2
      WHERE e2.ENG_EstruturaProduto = ees.ENG_EstruturaProduto
    )
  GROUP BY RTRIM(ees.ENG_EstruturaProduto), RTRIM(ei.ENG_EstruturaItemProduto), RTRIM(pp.PRO_Descricao)
`;

// Posição → item nas ordens de produção do projeto (para etiquetas
// "projeto-estrutura-posição"). ORD_OrdemProduto = código da estrutura.
const SELECT_POSICOES_PROJETO = `
  SELECT
    RTRIM(oo.ORD_OrdemProduto)         AS ordem_produto,
    RTRIM(oi.ORD_OrdemPrvItemProduto)  AS codigo,
    RTRIM(oi.ORD_OrdemPrvItemPosicao)  AS posicao
  FROM ORD_ORDEM AS oo
  JOIN ORD_ORDEMPRVITEM AS oi
    ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
  WHERE oo.ORD_OrdemProduto LIKE @chave
`;

// GET /api/relatorios/estrutura-projeto?projeto=250614
router.get('/estrutura-projeto', auth, apenasPerfisDeRelatorio, async (req, res) => {
  const projeto = String(req.query.projeto || '').trim();
  if (!PADRAO_PROJETO.test(projeto)) {
    return res.status(400).json({ erro: 'Informe o número do projeto com 6 dígitos (ou 8, se for reforma).' });
  }

  try {
    const pool = await getPool();
    const { recordset: estruturasErp } = await pool.request()
      .input('projeto', sql.NVarChar, projeto)
      .query(SELECT_ESTRUTURAS_PROJETO);

    if (!estruturasErp.length) {
      return res.status(404).json({ erro: `Nenhuma estrutura encontrada no ERP para o projeto ${projeto}.` });
    }

    const { recordset: itensErp } = await pool.request()
      .input('projeto', sql.NVarChar, projeto)
      .query(SELECT_ITENS_ESTRUTURAS_PROJETO);

    const { recordset: posicoes } = await pool.request()
      .input('chave', sql.NVarChar, `${projeto}-%`)
      .query(SELECT_POSICOES_PROJETO);

    const estruturas = estruturasErp.map((e) => ({
      codigo: e.codigo,
      descricao: e.descricao,
      itens: itensErp.filter((i) => i.estrutura === e.codigo),
    }));

    const [carregados] = await db.query(SELECT_CARREGADOS, [projeto, projeto]);
    const resultado = calcularFaltantesProjeto(estruturas, carregados, posicoes);

    if (querPdf(req)) {
      const todos = querTodos(req);
      const t = resultado.resumo;
      const grupos = resultado.estruturas
        .map((e) => ({
          titulo: e.codigo,
          subtitulo: `${e.descricao ? e.descricao + ' · ' : ''}${e.resumo.total} ${e.resumo.total === 1 ? 'item' : 'itens'} · ${e.resumo.com_falta} com falta`,
          itens: todos ? e.itens : e.itens.filter((i) => i.faltante > 0),
        }))
        .filter((g) => todos || g.itens.length);
      const pdf = await gerarRelatorioEstruturaPDF({
        titulo: 'RELATÓRIO DE ESTRUTURA',
        projeto,
        resumo: `${t.estruturas} ${t.estruturas === 1 ? 'estrutura' : 'estruturas'} · ${t.itens} itens · ${t.com_falta} com falta · ${t.completos} completos`,
        semFalta: t.com_falta === 0,
        mostrarTodos: todos,
        grupos,
      });
      return enviarPdf(res, pdf, `relatorio-estrutura-${projeto}.pdf`);
    }

    res.json({ projeto, ...resultado });
  } catch (err) {
    console.error('[GET /relatorios/estrutura-projeto]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar o relatório.' });
  }
});

module.exports = router;
