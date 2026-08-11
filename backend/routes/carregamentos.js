const router = require('express').Router();
const db     = require('../db');
const { auth, apenasExpedicao } = require('../middleware/auth');
const { enviarEmail } = require('../mail');
const { gerarRomaneioCarregamentoPDF } = require('../pdf/romaneioCarregamento');

// GET /api/carregamentos — histórico (mais recentes primeiro)
router.get('/', auth, async (req, res) => {
  try {
    const { tipo, status } = req.query;
    let sql = 'SELECT * FROM v_carregamentos_resumo WHERE 1=1';
    const params = [];
    if (tipo)   { sql += ' AND tipo = ?';   params.push(tipo); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY criado_em DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[GET /carregamentos]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar carregamentos.' });
  }
});

// GET /api/carregamentos/:id — detalhe com itens
router.get('/:id', auth, async (req, res) => {
  try {
    const [[carregamento]] = await db.query(
      'SELECT * FROM v_carregamentos_resumo WHERE id = ?',
      [req.params.id]
    );
    if (!carregamento) return res.status(404).json({ erro: 'Carregamento não encontrado.' });

    const [itens] = await db.query(
      'SELECT * FROM carregamento_itens WHERE carregamento_id = ? ORDER BY ordem ASC, id ASC',
      [req.params.id]
    );

    res.json({ ...carregamento, itens });
  } catch (err) {
    console.error('[GET /carregamentos/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar carregamento.' });
  }
});

// POST /api/carregamentos — registrar novo carregamento (Expedição)
router.post('/', auth, apenasExpedicao, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { responsavel_nome, numero_projeto, placa, cidade_destino, observacoes, itens } = req.body;

    if (!responsavel_nome || !numero_projeto || !placa || !cidade_destino) {
      conn.release();
      return res.status(400).json({ erro: 'Campos obrigatórios: responsavel_nome, numero_projeto, placa, cidade_destino.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      conn.release();
      return res.status(400).json({ erro: 'Inclua ao menos um item na lista de materiais.' });
    }
    for (const item of itens) {
      if (!item.codigo_item || !item.descricao || !item.quantidade) {
        conn.release();
        return res.status(400).json({ erro: 'Cada item precisa de código, descrição e quantidade.' });
      }
    }

    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO carregamentos (tipo, responsavel_nome, numero_projeto, placa, cidade_destino, observacoes, criado_por_perfil)
       VALUES ('carregamento', ?, ?, ?, ?, ?, ?)`,
      [responsavel_nome, numero_projeto, placa, cidade_destino, observacoes || null, req.usuario.perfil]
    );

    const carregamentoId = result.insertId;
    const caixaIdsUsadas = new Set();

    for (let i = 0; i < itens.length; i++) {
      const caixaId = itens[i].caixa_id || null;
      if (caixaId) caixaIdsUsadas.add(caixaId);

      await conn.query(
        `INSERT INTO carregamento_itens (carregamento_id, caixa_id, codigo_item, descricao, quantidade, ordem)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [carregamentoId, caixaId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, i + 1]
      );
    }

    // Marca como "expedida" qualquer caixa cujos itens tenham sido usados
    // neste carregamento — fecha o ciclo almoxarifado → pátio → caminhão.
    if (caixaIdsUsadas.size) {
      await conn.query(
        `UPDATE caixas SET status = 'expedida', expedido_em = NOW()
         WHERE id IN (?) AND status != 'expedida'`,
        [Array.from(caixaIdsUsadas)]
      );
    }

    await conn.commit();
    res.status(201).json({ id: carregamentoId, mensagem: 'Carregamento registrado com sucesso.' });
  } catch (err) {
    await conn.rollback();
    console.error('[POST /carregamentos]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar carregamento.' });
  } finally {
    conn.release();
  }
});

// POST /api/carregamentos/:id/romaneio — gera o PDF do romaneio do
// carregamento (itens + responsável + placa + destino), envia por
// e-mail e devolve o PDF na resposta para visualização/impressão
// imediata. Diferente da caixa, o carregamento já nasce completo
// (não tem estado "aberto"), então o romaneio está sempre disponível.
router.post('/:id/romaneio', auth, async (req, res) => {
  try {
    const [[carregamento]] = await db.query('SELECT * FROM v_carregamentos_resumo WHERE id = ?', [req.params.id]);
    if (!carregamento) return res.status(404).json({ erro: 'Carregamento não encontrado.' });

    const [itens] = await db.query(
      `SELECT ci.*, cx.codigo_barras AS caixa_codigo
       FROM carregamento_itens ci
       LEFT JOIN caixas cx ON cx.id = ci.caixa_id
       WHERE ci.carregamento_id = ?
       ORDER BY ci.ordem ASC, ci.id ASC`,
      [carregamento.id]
    );

    const pdfBuffer = await gerarRomaneioCarregamentoPDF({ carregamento, itens });
    const nomeArquivo = `romaneio-carregamento-${String(carregamento.numero_projeto).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    let emailEnviado = false;
    const destinatarios = (process.env.ROMANEIO_EMAIL_TO || '').trim();
    if (destinatarios) {
      try {
        await enviarEmail({
          to: destinatarios,
          subject: `Romaneio — Carregamento #${carregamento.numero_projeto}`,
          html: `
            <p>Segue em anexo o romaneio do carregamento <strong>#${carregamento.numero_projeto}</strong>,
            placa <strong>${carregamento.placa || '—'}</strong>, destino ${carregamento.cidade_destino},
            registrado em ${new Date(carregamento.criado_em).toLocaleString('pt-BR')}.</p>
            <p style="color:#6b7280;font-size:12px">Central Expedição — Burntech Caldeiras (e-mail automático)</p>
          `,
          attachments: [{ filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailEnviado = true;
      } catch (mailErr) {
        console.error('[POST /carregamentos/:id/romaneio] falha ao enviar e-mail:', mailErr.message);
      }
    } else {
      console.warn('[POST /carregamentos/:id/romaneio] ROMANEIO_EMAIL_TO não configurado — e-mail não enviado.');
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.set('X-Email-Enviado', emailEnviado ? 'true' : 'false');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /carregamentos/:id/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio.' });
  }
});

module.exports = router;
