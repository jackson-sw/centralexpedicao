// Gera a folha de relatório impressa junto com o lote de desenhos do
// perfil Pintura — lista quantos desenhos foram encontrados, o nome
// de cada um e se saiu com sucesso ou deu erro na impressora. Sai
// como a ÚLTIMA folha do lote (ver processarJobLote em agent.js):
// dá pra listar o resultado real (sucesso/erro) de cada arquivo, coisa
// que não dá pra saber antes de tentar imprimir todos.
//
// Estilo copiado do romaneio do backend (backend/pdf/romaneio.js) só
// pra manter a mesma identidade visual — duplicado aqui (em vez de
// importado) porque esta pasta é copiada inteira, sozinha, pra uma
// máquina separada (ver README.md), sem acesso ao restante do repositório.

const PDFDocument = require('pdfkit');

const RED    = '#c0392b';
const TEXT   = '#1a1d23';
const MUTED  = '#6b7280';
const BORDER = '#d1d5db';
const ZEBRA  = '#f8f9fb';
const GREEN  = '#166534';
const ERRO   = '#991b1b';

function fmtDT(data) {
  return new Date(data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// resultados: [{ arquivo: 'nome-do-pdf.pdf', sucesso: true|false, erro?: string }]
// Resolve com um Buffer do PDF gerado (1 página, ou mais se a lista for grande).
function gerarRelatorioLotePDF({ projeto, estrutura, resultados }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginX = 40;
    const contentRight = pageWidth - marginX;

    // Cabeçalho (mesma identidade visual do romaneio: barra vermelha +
    // monograma "BC")
    doc.rect(0, 0, pageWidth, 100).fill(RED);
    doc.roundedRect(40, 26, 46, 46, 10).fill('#ffffff');
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(18).text('BC', 40, 41, { width: 46, align: 'center' });
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('BURNTECH CALDEIRAS', 98, 34);
    doc.font('Helvetica').fontSize(10).text('Central Expedição · Agrolândia, SC', 98, 56);
    // Título à direita, numa faixa própria (não a largura inteira da
    // barra) pra não colidir com "BURNTECH CALDEIRAS" à esquerda —
    // "RELATÓRIO DE IMPRESSÃO DE DESENHOS" é bem mais longo que o
    // título do romaneio ("ROMANEIO DE CAIXA"), então a fonte é menor
    // e a área reservada começa depois do texto da esquerda.
    doc.font('Helvetica-Bold').fontSize(10).text('RELATÓRIO DE IMPRESSÃO', 300, 36, { width: pageWidth - 40 - 300, align: 'right' });
    doc.text('DE DESENHOS', 300, 48, { width: pageWidth - 40 - 300, align: 'right' });
    doc.font('Helvetica').fontSize(10).text(`${projeto}-${estrutura}`, 300, 64, { width: pageWidth - 40 - 300, align: 'right' });

    let y = 132;

    const total = resultados.length;
    const impressos = resultados.filter((r) => r.sucesso).length;
    const comErro = total - impressos;

    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text('Estrutura:', marginX, y);
    doc.font('Helvetica').text(`${projeto}-${estrutura}`, 130, y);
    y += 17;
    doc.font('Helvetica-Bold').text('Data/hora:', marginX, y);
    doc.font('Helvetica').text(fmtDT(new Date()), 130, y);
    y += 17;
    doc.font('Helvetica-Bold').text('Total de desenhos encontrados:', marginX, y);
    doc.font('Helvetica').text(String(total), 230, y);
    y += 17;
    doc.font('Helvetica-Bold').fillColor(GREEN).text('Impressos com sucesso:', marginX, y);
    doc.font('Helvetica').text(String(impressos), 230, y);
    y += 17;
    if (comErro > 0) {
      doc.font('Helvetica-Bold').fillColor(ERRO).text('Com erro na impressão:', marginX, y);
      doc.font('Helvetica').fillColor(TEXT).text(String(comErro), 230, y);
      y += 17;
    }
    doc.fillColor(TEXT);
    y += 14;

    // Tabela com o nome de cada desenho
    const colNum    = marginX;
    const colNome   = colNum + 34;
    const colStatus = contentRight - 110;
    const rowH = 20;
    const headerH = 22;
    const larguraNome = colStatus - colNome - 10;

    function cabecalhoTabela(yy) {
      doc.rect(marginX, yy, contentRight - marginX, headerH).fill('#f3f4f6');
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5);
      doc.text('#', colNum + 6, yy + 7);
      doc.text('DESENHO', colNome + 6, yy + 7);
      doc.text('STATUS', colStatus + 6, yy + 7);
      return yy + headerH;
    }

    y = cabecalhoTabela(y);
    doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();

    doc.font('Helvetica').fontSize(9);
    resultados.forEach((r, idx) => {
      const alturaNome = doc.heightOfString(r.arquivo, { width: larguraNome });
      const alturaLinha = Math.max(rowH, alturaNome + 10);

      if (y + alturaLinha > doc.page.height - 90) {
        doc.addPage();
        y = 40;
        y = cabecalhoTabela(y);
        doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.75).stroke();
      }
      if (idx % 2 === 1) {
        doc.rect(marginX, y, contentRight - marginX, alturaLinha).fill(ZEBRA);
      }
      doc.fillColor(TEXT).text(String(idx + 1), colNum + 6, y + 5, { width: colNome - colNum - 10 });
      doc.text(r.arquivo, colNome + 6, y + 5, { width: larguraNome });
      // Sem ✓/✗: a fonte padrão do PDF (Helvetica, WinAnsi) não tem esses
      // glifos e eles saem como caractere quebrado na impressão — só
      // texto colorido mesmo (verde/vermelho já basta pra bater o olho).
      doc.fillColor(r.sucesso ? GREEN : ERRO).font('Helvetica-Bold')
        .text(r.sucesso ? 'Impresso' : 'Erro', colStatus + 6, y + 5, { width: contentRight - colStatus - 10 });
      doc.font('Helvetica').fillColor(TEXT);
      y += alturaLinha;
      doc.moveTo(marginX, y).lineTo(contentRight, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    });

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

    doc.end();
  });
}

module.exports = { gerarRelatorioLotePDF };
