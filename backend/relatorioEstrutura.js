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
function calcularFaltantes(itensErp, carregados) {
  const porCodigo = new Map();   // CÓDIGO_NORMALIZADO -> { codigo, descricao, necessario, carregado }
  const porPosicao = new Map();  // "ORDEM_PRODUTO|posição" -> CÓDIGO_NORMALIZADO

  for (const it of itensErp) {
    const chave = norm(it.codigo);
    if (!chave) continue;
    const reg = porCodigo.get(chave) || {
      codigo: String(it.codigo).trim(),
      descricao: String(it.descricao == null ? '' : it.descricao).trim(),
      necessario: 0,
      carregado: 0,
    };
    reg.necessario += Number(it.quantidade) || 0;
    porCodigo.set(chave, reg);

    const pos = parseInt(it.posicao, 10);
    if (Number.isFinite(pos)) porPosicao.set(`${norm(it.ordem_produto)}|${pos}`, chave);
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

module.exports = { calcularFaltantes };
