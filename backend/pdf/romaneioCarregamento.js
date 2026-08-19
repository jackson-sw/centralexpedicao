const PDFDocument = require('pdfkit');

// ── Paleta (mesma identidade visual do app) ─────────────────────
const RED    = '#c0392b';
const TEXT   = '#1a1d23';
const MUTED  = '#6b7280';
const BORDER = '#d1d5db';
const ZEBRA  = '#f8f9fb';

function fmtDT(data) {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtQtd(q) {
  const n = parseFloat(q) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Gera o PDF do romaneio de um carregamento e resolve com um Buffer.
// { carregamento: linha de v_carregamentos_resumo, itens: linhas de
//   carregamento_itens (cada uma com um "caixa_codigo" opcional, já
//   resolvido pela rota, indicando de qual caixa o item veio) }
function gerarRomaneioCarregamentoPDF({ carregamento, itens }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth  = doc.page.width;
    const marginX    = 40;
    const contentRight = pageWidth - marginX;

    desenharCabecalho(doc, pageWidth, carregamento);

    let y = 132;

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text('Responsável:', marginX, y);
    doc.font('Helvetica').text(carregamento.responsavel_nome || '—', 230, y);
    y += 17;

    doc.font('Helvetica-Bold').text('Placa do caminhão:', marginX, y);
    doc.font('Helvetica').text(carregamento.placa || '—', 230, y);
    y += 17;

    doc.font('Helvetica-Bold').text('Cidade de destino:', marginX, y);
    doc.font('Helvetica').text(carregamento.cidade_destino || '—', 230, y, { width: contentRight - 230 });
    y += 17;

    doc.font('Helvetica-Bold').text('Data/hora do carregamento:', marginX, y);
    doc.font('Helvetica').text(fmtDT(carregamento.criado_em), 230, y);
    y += 17;

    if (carregamento.observacoes) {
      doc.font('Helvetica-Bold').text('Observações:', marginX, y);
      doc.font('Helvetica').text(carregamento.observacoes, 230, y, { width: contentRight - 230 });
      y += Math.max(17, doc.heightOfString(carregamento.observacoes, { width: contentRight - 230 }) + 5);
    }
    y += 14;

    y = desenharTabelaItens(doc, { marginX, contentRight, y, itens });

    y += 16;
    const totalItens = itens.length;
    const totalQtd = itens.reduce((s, i) => s + (parseFloat(i.quantidade) || 0), 0);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT)
      .text(`Total de itens: ${totalItens}    ·    Quantidade total: ${fmtQtd(totalQtd)}`, marginX, y);

    desenharRodape(doc, pageWidth);

    doc.end();
  });
}

function desenharCabecalho(doc, pageWidth, carregamento) {
  doc.rect(0, 0, pageWidth, 100).fill(RED);

  // Monograma (mesmo estilo do ícone do app: quadrado arredondado vermelho)
  doc.roundedRect(40, 26, 46, 46, 10).fill('#ffffff');
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(18).text('BC', 40, 41, { width: 46, align: 'center' });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
    .text('BURNTECH CALDEIRAS', 98, 34);
  doc.font('Helvetica').fontSize(10)
    .text('Central Expedição · Agrolândia, SC', 98, 56);

  doc.font('Helvetica-Bold').fontSize(13)
    .text('ROMANEIO DE CARREGAMENTO', 0, 34, { width: pageWidth - 40, align: 'right' });
  doc.font('Helvetica').fontSize(11)
    .text('#' + carregamento.numero_projeto + '-' + carregamento.sequencial_projeto, 0, 56, { width: pageWidth - 40, align: 'right' });
}

function desenharTabelaItens(doc, { marginX, contentRight, y, itens }) {
  // Larguras fixas (código, descrição, qtd, origem) — o que sobra vai para
  // a coluna Responsável, sempre até contentRight. Código mais largo que
  // antes porque, com o catálogo vindo do ERP, os códigos podem ser bem
  // mais longos que os internos de antes (ex.: "250063-TCR100").
  const colCodigo    = marginX;
  const colDescricao = colCodigo + 100;
  const colQtd       = colDescricao + 165;
  const colOrigem    = colQtd + 45;
  const colResp       = colOrigem + 75;
  const rowH = 20;
  const headerH = 22;
  const larguraCodigo    = colDescricao - colCodigo - 10;
  const larguraDescricao = colQtd - colDescricao - 10;

  function cabecalhoTabela(yy) {
    doc.rect(marginX, yy, contentRight - marginX, headerH).fill('#f3f4f6');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
    doc.text('CÓDIGO',       colCodigo + 6,    yy + 7);
    doc.text('DESCRIÇÃO',    colDescricao + 6, yy + 7);
    doc.text('QTD.',         colQtd + 6,       yy + 7);
    doc.text('ORIGEM',       colOrigem + 6,    yy + 7);
    doc.text('RESPONSÁVEL',  colResp + 6,      yy + 7);
    return yy + headerH;
  }

  y = cabecalhoTabela(y);
  doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();

  doc.font('Helvetica').fontSize(9);
  itens.forEach((item, idx) => {
    // Código ou descrição longos podem quebrar em mais de uma linha — a
    // altura da linha da tabela precisa acompanhar isso, senão o traço
    // divisório é desenhado por cima do texto que "vazou" da linha.
    const alturaCodigo    = doc.heightOfString(item.codigo_item || '', { width: larguraCodigo });
    const alturaDescricao = doc.heightOfString(item.descricao || '',   { width: larguraDescricao });
    const alturaLinha = Math.max(rowH, Math.max(alturaCodigo, alturaDescricao) + 10);

    if (y + alturaLinha > doc.page.height - 90) {
      doc.addPage();
      y = 40;
      y = cabecalhoTabela(y);
      doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();
    }
    if (idx % 2 === 1) {
      doc.rect(marginX, y, contentRight - marginX, alturaLinha).fill(ZEBRA);
    }
    // Item avulso (sem caixa_id) foi escaneado/digitado diretamente pela
    // Expedição no momento do carregamento — não passou pelo Almoxarifado.
    // Linha representando uma caixa inteira (caixa_id preenchido, sem
    // caixa_codigo individual resolvido pela consulta) fica com Origem e
    // Responsável em branco — o controle de quem montou a caixa é interno
    // ao Almoxarifado. Só o formato antigo (item expandido individualmente
    // de uma caixa) mostra o código da caixa aqui.
    const origem = item.caixa_id ? (item.caixa_codigo || '') : 'Expedição';
    doc.fillColor(TEXT);
    doc.text(item.codigo_item,           colCodigo + 6,    y + 5, { width: larguraCodigo });
    doc.text(item.descricao,             colDescricao + 6, y + 5, { width: larguraDescricao });
    doc.text(fmtQtd(item.quantidade),    colQtd + 6,       y + 5, { width: colOrigem - colQtd - 10 });
    doc.text(origem,                     colOrigem + 6,    y + 5, { width: colResp - colOrigem - 10 });
    doc.text(item.responsavel_item || '', colResp + 6,     y + 5, { width: contentRight - colResp - 10 });
    y += alturaLinha;
    doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.5).stroke();
  });

  return y;
}

function desenharRodape(doc, pageWidth) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica')
      .text(
        `Documento gerado em ${fmtDT(new Date())} — Burntech Caldeiras, Agrolândia/SC`,
        40, doc.page.height - 40,
        { width: pageWidth - 80, align: 'center' }
      );
  }
}

module.exports = { gerarRomaneioCarregamentoPDF };
