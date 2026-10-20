// Cálculo do "Relatório de estrutura de itens faltantes para envio":
// compara o que a estrutura precisa (itens do ERP, somados por item)
// com o que já foi carregado em Carregamentos do projeto. Função pura —
// sem acesso a banco — pra ser fácil de testar (ver routes/relatorios.js
// pra de onde vêm os dados).

function norm(s) {
  return String(s == null ? '' : s).trim().toUpperCase();
}

// Evita ruído de ponto flutuante (ex.: 0.1 + 0.2) nas somas de quantidade.
function arredonda(n) {
  return Math.round(n * 10000) / 10000;
}

// itensErp: [{ ordem_produto, codigo, descricao, quantidade, posicao }]
//   — uma linha por item de cada ordem encontrada no ERP. O mesmo código
//   pode aparecer em várias linhas (posições/ordens diferentes): as
//   quantidades são SOMADAS.
// carregados: [{ codigo_item, quantidade }] — uma linha por item
//   carregado (de qualquer carregamento do projeto, já com o conteúdo
//   das caixas expandido).
//
// Um código carregado é associado a um item da estrutura de duas formas
// (as mesmas duas formas de etiqueta usadas no resto do sistema):
//   1) código do item igual ao do ERP (ex.: "ACABRU-0001");
//   2) código de estrutura + posição (ex.: "250614-TCA100-0078"): o
//      prefixo é o ORD_OrdemProduto e o final é a posição na ordem
//      (comparada como número, "78" = "0078").
// Códigos que não se associam a nenhum item da estrutura (peças de
// outras estruturas do mesmo projeto, por exemplo) são ignorados.
//
// posicoes (opcional): [{ ordem_produto, codigo, posicao }] — mapa de
// posição → código do item (ordem de produção). Quando informado, é ele
// que alimenta a associação por posição (as quantidades vêm de itensErp,
// da engenharia, que não tem a posição da ordem). Sem ele, usa
// ordem_produto/posicao de itensErp, como antes.
function calcularFaltantes(itensErp, carregados, posicoes) {
  const porCodigo = new Map();   // CÓDIGO_NORMALIZADO -> { codigo, descricao, necessario, carregado }
  const porPosicao = new Map();  // "ORDEM_PRODUTO|posição" -> CÓDIGO_NORMALIZADO

  for (const it of itensErp) {
    const chave = norm(it.codigo);
    if (!chave) continue;
    const reg = porCodigo.get(chave) || {
      codigo: String(it.codigo).trim(),
      descricao: String(it.descricao == null ? '' : it.descricao).trim(),
      und: String(it.und == null ? '' : it.und).trim(),
      necessario: 0,
      carregado: 0,
    };
    reg.necessario += Number(it.quantidade) || 0;
    porCodigo.set(chave, reg);

    const pos = parseInt(it.posicao, 10);
    if (Number.isFinite(pos)) porPosicao.set(`${norm(it.ordem_produto)}|${pos}`, chave);
  }

  for (const p of posicoes || []) {
    const chave = norm(p.codigo);
    const pos = parseInt(p.posicao, 10);
    // só associa a itens que existem na estrutura da engenharia
    if (porCodigo.has(chave) && Number.isFinite(pos)) porPosicao.set(`${norm(p.ordem_produto)}|${pos}`, chave);
  }

  for (const c of carregados) {
    const codigo = norm(c.codigo_item);
    if (!codigo) continue;
    let alvo = porCodigo.has(codigo) ? codigo : null;
    if (!alvo) {
      const m = /^(.+)-(\d+)$/.exec(codigo);
      if (m) alvo = porPosicao.get(`${m[1]}|${parseInt(m[2], 10)}`) || null;
    }
    if (alvo) porCodigo.get(alvo).carregado += Number(c.quantidade) || 0;
  }

  const itens = [...porCodigo.values()]
    .map((r) => ({
      codigo: r.codigo,
      descricao: r.descricao,
      und: r.und,
      necessario: arredonda(r.necessario),
      carregado: arredonda(r.carregado),
      faltante: arredonda(Math.max(r.necessario - r.carregado, 0)),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));

  const comFalta = itens.filter((i) => i.faltante > 0).length;
  return {
    itens,
    resumo: { total: itens.length, com_falta: comFalta, completos: itens.length - comFalta },
  };
}

// Versão do projeto inteiro: compara TODAS as estruturas do projeto com o
// que foi carregado, estrutura por estrutura.
//
// estruturas: [{ codigo, descricao, itens: [{ codigo, descricao, und, quantidade }] }]
//   (itens já somados por código dentro de cada estrutura).
// carregados: [{ codigo_item, quantidade }] — como em calcularFaltantes.
// posicoes: [{ ordem_produto, codigo, posicao }] — posição → item, das
//   ordens de produção do projeto (ordem_produto = código da estrutura).
//
// Como associar o carregado a UMA estrutura:
//  - etiqueta com posição ("250614-TCA100-0078"): o prefixo identifica a
//    estrutura e a posição o item — vai direto para ela;
//  - código de item puro ("MPCHAP-0010"): não diz a qual estrutura
//    pertence. Se o mesmo item existir em mais de uma estrutura, a
//    quantidade carregada é distribuída na ordem das estruturas (código
//    ascendente), cada uma recebendo no máximo o que ainda precisa.
// Códigos que não pertencem a nenhuma estrutura do projeto são ignorados.
function calcularFaltantesProjeto(estruturas, carregados, posicoes) {
  const lista = estruturas.map((e) => {
    const itens = new Map(); // CÓDIGO_NORMALIZADO -> registro
    for (const it of e.itens) {
      const chave = norm(it.codigo);
      if (!chave) continue;
      const reg = itens.get(chave) || {
        codigo: String(it.codigo).trim(),
        descricao: String(it.descricao == null ? '' : it.descricao).trim(),
        und: String(it.und == null ? '' : it.und).trim(),
        necessario: 0,
        carregado: 0,
      };
      reg.necessario += Number(it.quantidade) || 0;
      itens.set(chave, reg);
    }
    return { codigo: String(e.codigo).trim(), descricao: String(e.descricao == null ? '' : e.descricao).trim(), itens };
  }).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));

  const porEstrutura = new Map(lista.map((e) => [norm(e.codigo), e]));
  const porPosicao = new Map(); // "ESTRUTURA|posição" -> CÓDIGO_NORMALIZADO
  for (const p of posicoes || []) {
    const est = porEstrutura.get(norm(p.ordem_produto));
    const chave = norm(p.codigo);
    const pos = parseInt(p.posicao, 10);
    if (est && est.itens.has(chave) && Number.isFinite(pos)) porPosicao.set(`${norm(p.ordem_produto)}|${pos}`, chave);
  }

  const codigosDoProjeto = new Set();
  for (const e of lista) for (const k of e.itens.keys()) codigosDoProjeto.add(k);

  const pool = new Map(); // código puro -> quantidade a distribuir
  for (const c of carregados) {
    const codigo = norm(c.codigo_item);
    const qtd = Number(c.quantidade) || 0;
    if (!codigo) continue;
    if (codigosDoProjeto.has(codigo)) {
      pool.set(codigo, (pool.get(codigo) || 0) + qtd);
      continue;
    }
    const m = /^(.+)-(\d+)$/.exec(codigo);
    if (!m) continue;
    const chave = porPosicao.get(`${m[1]}|${parseInt(m[2], 10)}`);
    if (chave) porEstrutura.get(m[1]).itens.get(chave).carregado += qtd;
  }

  for (const e of lista) {
    for (const [chave, reg] of e.itens) {
      const disponivel = pool.get(chave) || 0;
      if (disponivel <= 0) continue;
      const usa = Math.min(disponivel, Math.max(reg.necessario - reg.carregado, 0));
      reg.carregado += usa;
      pool.set(chave, disponivel - usa);
    }
  }

  const total = { itens: 0, com_falta: 0, completos: 0 };
  const saida = lista.map((e) => {
    const itens = [...e.itens.values()]
      .map((r) => ({
        codigo: r.codigo,
        descricao: r.descricao,
        und: r.und,
        necessario: arredonda(r.necessario),
        carregado: arredonda(r.carregado),
        faltante: arredonda(Math.max(r.necessario - r.carregado, 0)),
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    const comFalta = itens.filter((i) => i.faltante > 0).length;
    total.itens += itens.length;
    total.com_falta += comFalta;
    total.completos += itens.length - comFalta;
    return { codigo: e.codigo, descricao: e.descricao, resumo: { total: itens.length, com_falta: comFalta, completos: itens.length - comFalta }, itens };
  });

  return { estruturas: saida, resumo: { estruturas: saida.length, ...total } };
}

module.exports = { calcularFaltantes, calcularFaltantesProjeto };
