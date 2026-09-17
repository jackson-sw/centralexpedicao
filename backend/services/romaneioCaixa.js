const db = require('../db');
const { gerarRomaneioPDF } = require('../pdf/romaneio');

// Monta o PDF do romaneio de uma caixa a partir do id — usado tanto
// pelo download/e-mail manual (POST /api/caixas/:id/romaneio, disparado
// pelo botão "🧾 Romaneio") quanto pela impressão automática na laser
// do perfil Produção (GET /api/romaneio-impressao/:id/pdf, baixado
// pelo print-agent/) — evita duplicar a lógica de busca/montagem nos
// dois lugares.
async function montarPdfRomaneioCaixa(id) {
  const [[caixa]] = await db.query('SELECT * FROM v_caixas_resumo WHERE id = ?', [id]);
  if (!caixa) return null;

  const [itens] = await db.query(
    'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
    [caixa.id]
  );
  const responsaveis = [...new Set(itens.map(i => i.responsavel_nome).filter(Boolean))];

  const pdfBuffer = await gerarRomaneioPDF({ caixa, itens, responsaveis });

  return { caixa, itens, responsaveis, pdfBuffer };
}

module.exports = { montarPdfRomaneioCaixa };
