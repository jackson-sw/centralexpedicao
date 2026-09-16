const db = require('../db');
const { gerarRomaneioPDF } = require('../pdf/romaneio');

// Monta o PDF do romaneio de Produção a partir do id — usado tanto pelo
// download/e-mail manual (POST /api/romaneios-producao/:id/romaneio,
// disparado pelo botão "🧾 Romaneio"/"Gerar Romaneio" no app) quanto
// pela impressão automática na laser (GET /api/romaneio-impressao/:id/pdf,
// baixado pelo print-agent/) — evita duplicar a lógica de busca/montagem
// nos dois lugares.
async function montarPdfRomaneioProducao(id) {
  const [[romaneio]] = await db.query('SELECT * FROM v_romaneios_producao_resumo WHERE id = ?', [id]);
  if (!romaneio) return null;

  const [itens] = await db.query(
    'SELECT * FROM romaneio_producao_itens WHERE romaneio_id = ? ORDER BY ordem ASC, id ASC',
    [romaneio.id]
  );
  const responsaveis = [...new Set(itens.map(i => i.responsavel_nome).filter(Boolean))];

  const pdfBuffer = await gerarRomaneioPDF({
    caixa: romaneio,
    itens,
    responsaveis,
    titulo: 'ROMANEIO DE PRODUÇÃO',
    rotuloResponsaveis: 'Responsável(is) que montaram o romaneio:',
  });

  return { romaneio, itens, responsaveis, pdfBuffer };
}

module.exports = { montarPdfRomaneioProducao };
