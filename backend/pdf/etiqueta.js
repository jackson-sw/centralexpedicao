const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

// ── Conversão mm → pontos (unidade nativa do pdfkit) ────────────
const MM = 2.83464567;
function mm(v) { return v * MM; }

function fmtDT(data) {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Lê largura/altura (em px) direto do cabeçalho IHDR do PNG — o
// bwip-js não devolve essas dimensões junto do buffer, e precisamos
// delas pra desenhar o código de barras mantendo a proporção correta
// (mesma lógica do CSS "width:74mm;height:auto" usado antes no
// navegador).
function pngDimensions(buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

// Gera o PDF da etiqueta física da caixa (100mm x 70mm — mesmo
// tamanho e layout que já existia na impressão pelo navegador) e
// resolve com um Buffer. { caixa: linha de v_caixas_resumo }
// Layout centralizado verticalmente, com altura de cada bloco
// calculada dinamicamente (mesmo padrão de heightOfString usado nos
// romaneios) para não depender de nenhuma medida "no olho".
function gerarEtiquetaPDF({ caixa }) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const widthPt = mm(100);
        const heightPt = mm(70);
        const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const codigo = caixa.codigo_barras || ('CX' + String(caixa.id).padStart(6, '0'));
        const padX = mm(6);
        const contentWidth = widthPt - padX * 2;
        const gap = mm(1.6);

        const brandText    = 'BURNTECH CALDEIRAS — CENTRAL EXPEDIÇÃO';
        const projetoText  = caixa.numero_projeto ? ('Projeto: ' + caixa.numero_projeto) : '';
        const fechadoText  = caixa.fechado_em ? ('Fechada em: ' + fmtDT(caixa.fechado_em)) : '';

        doc.font('Helvetica-Bold').fontSize(mm(2.7));
        const brandHeight = doc.heightOfString(brandText, { width: contentWidth, align: 'center' });

        let projetoHeight = 0;
        if (projetoText) {
          doc.font('Helvetica-Bold').fontSize(mm(3.2));
          projetoHeight = doc.heightOfString(projetoText, { width: contentWidth, align: 'center' });
        }

        const png = await bwipjs.toBuffer({
          bcid: 'code128', text: codigo, scale: 3, height: 14, includetext: false,
        });
        const { width: pxW, height: pxH } = pngDimensions(png);
        const barcodeWidth  = mm(74);
        const barcodeHeight = barcodeWidth * (pxH / pxW);

        doc.font('Courier-Bold').fontSize(mm(4.2));
        const codeHeight = doc.heightOfString(codigo, { width: contentWidth, align: 'center', characterSpacing: mm(1) });

        let fechadoHeight = 0;
        if (fechadoText) {
          doc.font('Helvetica').fontSize(mm(2.4));
          fechadoHeight = doc.heightOfString(fechadoText, { width: contentWidth, align: 'center' });
        }

        const blocks = [brandHeight, projetoHeight, barcodeHeight, codeHeight, fechadoHeight].filter((h) => h > 0);
        const totalContentHeight = blocks.reduce((s, h) => s + h, 0) + gap * (blocks.length - 1);
        let y = Math.max(mm(2), (heightPt - totalContentHeight) / 2);

        doc.font('Helvetica-Bold').fontSize(mm(2.7)).fillColor('#1a1d23')
          .text(brandText, padX, y, { width: contentWidth, align: 'center' });
        y += brandHeight + gap;

        if (projetoText) {
          doc.font('Helvetica-Bold').fontSize(mm(3.2))
            .text(projetoText, padX, y, { width: contentWidth, align: 'center', lineBreak: false, ellipsis: true });
          y += projetoHeight + gap;
        }

        doc.image(png, (widthPt - barcodeWidth) / 2, y, { width: barcodeWidth });
        y += barcodeHeight + gap;

        doc.font('Courier-Bold').fontSize(mm(4.2)).fillColor('#1a1d23')
          .text(codigo, padX, y, { width: contentWidth, align: 'center', characterSpacing: mm(1) });
        y += codeHeight + gap;

        if (fechadoText) {
          doc.font('Helvetica').fontSize(mm(2.4)).fillColor('#333333')
            .text(fechadoText, padX, y, { width: contentWidth, align: 'center' });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

module.exports = { gerarEtiquetaPDF };
