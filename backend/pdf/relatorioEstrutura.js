const PDFDocument = require('pdfkit');

// ── Paleta (mesma identidade visual do app) ─────────────────────
const RED    = '#c0392b';
const TEXT   = '#1a1d23';
const MUTED  = '#6b7280';
const BORDER = '#d1d5db';
const ZEBRA  = '#f8f9fb';
const GREEN  = '#166534';

// Sempre no horário de Brasília, independente do fuso do servidor.
const TZ_BRASIL = 'America/Sao_Paulo';

function fmtDT(data) {
  const d = new Date(data);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASIL }) + ' às ' + d.toLocaleTimeString('pt-BR', { timeZone: TZ_BRASIL, hour: '2-digit', minute: '2-digit' });
}

function fmtQtd(n) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

// Gera o PDF dos relatórios de estrutura (itens faltantes para envio, de
// uma estrutura ou do projeto inteiro) e resolve com um Buffer.
// {
//   titulo:   'RELATÓRIO DE ESTRUTURA' (cabeçalho, canto direito),
//   projeto:  '250614',
//   resumo:   texto de resumo em destaque,
//   grupos:   [{ titulo, subtitulo?, itens: [{ codigo, descricao, und,
//             necessario, carregado, faltante }] }] — uma tabela por grupo
//             (uma estrutura por grupo),
//   mostrarTodos: se false, só os itens com falta já vêm em `itens`
//             (quem chama filtra) — aqui só muda a mensagem de grupo vazio.
// }
function gerarRelatorioEstruturaPDF({ titulo, projeto, resumo, semFalta, grupos, mostrarTodos, rotuloCarregado = 'CARREGADO' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginX = 40;
    const contentRight = pageWidth - marginX;

    // Colunas da tabela
    const colItem = marginX;
    const colCodigo = marginX + 26;
    const colDescricao = colCodigo + 84;
    const colUnd = colDescricao + 183;
    const colEstrutura = colUnd + 32;
    const colCarregado = colEstrutura + 62;
    const colFaltante = colCarregado + 62;
    const larguraCodigo = colDescricao - colCodigo - 6;
    const larguraDescricao = colUnd - colDescricao - 8;
    const larguraNum = 56;
    const rowH = 20;
    const headerH = 22;
    const limiteY = () => doc.page.height - 60;

    desenharCabecalho(doc, pageWidth, titulo, projeto);

    let y = 124;
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text('Projeto:', marginX, y);
    doc.font('Helvetica').text(projeto, 130, y);
    y += 17;
    doc.font('Helvetica-Bold').text('Gerado em:', marginX, y);
    doc.font('Helvetica').text(fmtDT(new Date()), 130, y);
    y += 24;

    doc.roundedRect(marginX, y, contentRight - marginX, 34, 8).fill(semFalta ? '#f0fdf4' : '#fffbeb');
    doc.fillColor(semFalta ? GREEN : '#b45309').font('Helvetica-Bold').fontSize(11)
      .text(resumo, marginX + 14, y + 11, { width: contentRight - marginX - 28 });
    y += 34 + 18;

    function cabecalhoTabela(yy) {
      doc.rect(marginX, yy, contentRight - marginX, headerH).fill('#f3f4f6');
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
      doc.text('ITEM', colItem, yy + 7, { width: 22, align: 'right' });
      doc.text('CÓDIGO', colCodigo + 6, yy + 7);
      doc.text('DESCRIÇÃO', colDescricao + 6, yy + 7);
      doc.text('UND', colUnd + 2, yy + 7);
      doc.text('ESTRUTURA', colEstrutura, yy + 7, { width: larguraNum, align: 'right' });
      doc.text(rotuloCarregado, colCarregado, yy + 7, { width: larguraNum, align: 'right' });
      doc.text('FALTANTE', colFaltante, yy + 7, { width: larguraNum, align: 'right' });
      return yy + headerH;
    }

    for (const grupo of grupos) {
      // Título do grupo + cabeçalho da tabela precisam caber juntos com
      // pelo menos uma linha — senão passa para a página seguinte.
      if (y + 26 + headerH + rowH > limiteY()) { doc.addPage(); y = 40; }

      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(11).text(grupo.titulo, marginX, y, { width: contentRight - marginX });
      y += 16;
      if (grupo.subtitulo) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(grupo.subtitulo, marginX, y, { width: contentRight - marginX });
        y += 14;
      }

      if (!grupo.itens.length) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
          .text(mostrarTodos ? 'Nenhum item nesta estrutura.' : 'Nenhum item faltando nesta estrutura.', marginX, y);
        y += 26;
        continue;
      }

      y = cabecalhoTabela(y);
      doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();

      doc.font('Helvetica').fontSize(9);
      grupo.itens.forEach((it, idx) => {
        const altCodigo = doc.heightOfString(it.codigo || '', { width: larguraCodigo });
        const altDescricao = doc.heightOfString(it.descricao || '', { width: larguraDescricao });
        const alturaLinha = Math.max(rowH, Math.max(altCodigo, altDescricao) + 10);

        if (y + alturaLinha > limiteY()) {
          doc.addPage();
          y = 40;
          y = cabecalhoTabela(y);
          doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();
          doc.font('Helvetica').fontSize(9);
        }

        if (idx % 2 === 1) doc.rect(marginX, y, contentRight - marginX, alturaLinha).fill(ZEBRA);
        doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(String(idx + 1), colItem, y + 6, { width: 22, align: 'right' });
        doc.fillColor(TEXT).font('Courier-Bold').fontSize(8.5).text(it.codigo || '', colCodigo + 6, y + 6, { width: larguraCodigo });
        doc.font('Helvetica').fontSize(9).text(it.descricao || '', colDescricao + 6, y + 6, { width: larguraDescricao });
        doc.text(it.und || '', colUnd + 2, y + 6, { width: 30 });
        doc.text(fmtQtd(it.necessario), colEstrutura, y + 6, { width: larguraNum, align: 'right' });
        doc.text(fmtQtd(it.carregado), colCarregado, y + 6, { width: larguraNum, align: 'right' });
        doc.fillColor(it.faltante > 0 ? RED : GREEN).font('Helvetica-Bold')
          .text(fmtQtd(it.faltante), colFaltante, y + 6, { width: larguraNum, align: 'right' });
        y += alturaLinha;
        doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      });

      y += 22;
    }

    // Rodapé com paginação em todas as páginas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`Burntech Caldeiras · Central Expedição — página ${i + 1} de ${range.count}`, 0, doc.page.height - 36, { width: pageWidth, align: 'center', lineBreak: false });
    }

    doc.end();
  });
}

function desenharCabecalho(doc, pageWidth, titulo, projeto) {
  doc.rect(0, 0, pageWidth, 100).fill(RED);

  doc.roundedRect(40, 26, 46, 46, 10).fill('#ffffff');
  doc.fillColor(RED).font('Helvetica-Bold').fontSize(18).text('BC', 40, 41, { width: 46, align: 'center' });

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('BURNTECH CALDEIRAS', 98, 34);
  doc.font('Helvetica').fontSize(10).text('Central Expedição · Agrolândia, SC', 98, 56);

  doc.font('Helvetica-Bold').fontSize(13).text(titulo, 0, 34, { width: pageWidth - 40, align: 'right' });
  doc.font('Helvetica').fontSize(11).text('Projeto ' + projeto, 0, 56, { width: pageWidth - 40, align: 'right' });
}

module.exports = { gerarRelatorioEstruturaPDF };
