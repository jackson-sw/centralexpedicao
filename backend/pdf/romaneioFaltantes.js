const PDFDocument = require('pdfkit');

// ── Paleta (identidade do app, com destaque em âmbar para o alerta
// de itens faltantes) ────────────────────────────────────────────
const RED    = '#c0392b';
const AMBER  = '#b45309';
const TEXT   = '#1a1d23';
const MUTED  = '#6b7280';
const BORDER = '#d1d5db';
const ZEBRA  = '#fffbeb';
const GREEN  = '#166534';

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

// Gera o PDF de itens faltantes de um desembarque (perfil Em Campo) e
// resolve com um Buffer. { carregamento, itensFaltantes, totalItens,
// responsavelDesembarque } — itensFaltantes já vem filtrado pela rota
// (só os que ainda não têm desembarcado_em).
function gerarRomaneioFaltantesPDF({ carregamento, itensFaltantes, totalItens, responsavelDesembarque }) {
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

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text('Responsável pelo carregamento:', marginX, y);
    doc.font('Helvetica').text(carregamento.responsavel_nome || '—', 260, y);
    y += 17;

    doc.font('Helvetica-Bold').text('Placa do caminhão:', marginX, y);
    doc.font('Helvetica').text(carregamento.placa || '—', 260, y);
    y += 17;

    doc.font('Helvetica-Bold').text('Cidade de destino:', marginX, y);
    doc.font('Helvetica').text(carregamento.cidade_destino || '—', 260, y, { width: contentRight - 260 });
    y += 17;

    doc.font('Helvetica-Bold').text('Responsável pelo desembarque:', marginX, y);
    doc.font('Helvetica').text(responsavelDesembarque || '—', 260, y);
    y += 17;

    doc.font('Helvetica-Bold').text('Conferido em:', marginX, y);
    doc.font('Helvetica').text(fmtDT(new Date()), 260, y);
    y += 24;

    // Resumo em destaque — quantos faltam de quantos no total.
    const temFaltantes = itensFaltantes.length > 0;
    const corResumo = temFaltantes ? AMBER : GREEN;
    doc.roundedRect(marginX, y, contentRight - marginX, 34, 8).fill(temFaltantes ? '#fffbeb' : '#f0fdf4');
    doc.fillColor(corResumo).font('Helvetica-Bold').fontSize(11).text(
      temFaltantes
        ? `⚠ ${itensFaltantes.length} de ${totalItens} ${totalItens === 1 ? 'item não foi conferido' : 'itens não foram conferidos'}`
        : `✓ Todos os ${totalItens} itens foram conferidos no desembarque`,
      marginX + 14, y + 11
    );
    y += 34 + 20;

    if (temFaltantes) {
      y = desenharTabelaItens(doc, { marginX, contentRight, y, itens: itensFaltantes });
    } else {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10)
        .text('Nenhum item pendente — este romaneio é só um registro de conferência completa.', marginX, y);
      y += 20;
    }

    desenharRodape(doc, pageWidth);

    doc.end();
  });
}

function desenharCabecalho(doc, pageWidth, carregamento) {
  doc.rect(0, 0, pageWidth, 100).fill(RED);

  doc.roundedRect(40, 26, 46, 46, 10).fill('#ffffff');
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(18).text('BC', 40, 41, { width: 46, align: 'center' });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
    .text('BURNTECH CALDEIRAS', 98, 34);
  doc.font('Helvetica').fontSize(10)
    .text('Central Expedição · Agrolândia, SC', 98, 56);

  doc.font('Helvetica-Bold').fontSize(13)
    .text('ROMANEIO — ITENS FALTANTES', 0, 34, { width: pageWidth - 40, align: 'right' });
  doc.font('Helvetica').fontSize(11)
    .text('#' + carregamento.numero_projeto, 0, 56, { width: pageWidth - 40, align: 'right' });
}

function desenharTabelaItens(doc, { marginX, contentRight, y, itens }) {
  const colCodigo    = marginX;
  const colDescricao = colCodigo + 90;
  const colQtd       = colDescricao + 280;
  const colOrigem    = colQtd + 55;
  const rowH = 20;
  const headerH = 22;

  function cabecalhoTabela(yy) {
    doc.rect(marginX, yy, contentRight - marginX, headerH).fill('#f3f4f6');
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
    doc.text('CÓDIGO',    colCodigo + 6,    yy + 7);
    doc.text('DESCRIÇÃO', colDescricao + 6, yy + 7);
    doc.text('QTD.',      colQtd + 6,       yy + 7);
    doc.text('ORIGEM',    colOrigem + 6,    yy + 7);
    return yy + headerH;
  }

  y = cabecalhoTabela(y);
  doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();

  doc.font('Helvetica').fontSize(9);
  itens.forEach((item, idx) => {
    if (y + rowH > doc.page.height - 90) {
      doc.addPage();
      y = 40;
      y = cabecalhoTabela(y);
      doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();
    }
    if (idx % 2 === 1) {
      doc.rect(marginX, y, contentRight - marginX, rowH).fill(ZEBRA);
    }
    const origem = item.caixa_id ? (item.caixa_codigo || '') : 'Expedição';
    doc.fillColor(TEXT);
    doc.text(item.codigo_item,        colCodigo + 6,    y + 5, { width: colDescricao - colCodigo - 10 });
    doc.text(item.descricao,          colDescricao + 6, y + 5, { width: colQtd - colDescricao - 10 });
    doc.text(fmtQtd(item.quantidade), colQtd + 6,       y + 5, { width: colOrigem - colQtd - 10 });
    doc.text(origem,                  colOrigem + 6,    y + 5, { width: contentRight - colOrigem - 10 });
    y += rowH;
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

module.exports = { gerarRomaneioFaltantesPDF };
