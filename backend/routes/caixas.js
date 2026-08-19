const router = require('express').Router();
const db     = require('../db');
const { auth, apenasAlmoxarifado } = require('../middleware/auth');
const { ALMOXARIFADO_RESPONSAVEIS } = require('../constants');
const { enviarEmail, sanitizarErroHeader } = require('../mail');
const { gerarRomaneioPDF } = require('../pdf/romaneio');

function responsavelValido(nome) {
  return typeof nome === 'string' && ALMOXARIFADO_RESPONSAVEIS.includes(nome.trim());
}

// GET /api/caixas — histórico (mais recentes primeiro)
router.get('/', auth, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM v_caixas_resumo WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY criado_em DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[GET /caixas]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixas.' });
  }
});

// GET /api/caixas/codigo/:codigo — busca por código de barras
// Usado pelo scanner do "Novo Carregamento" para expandir os
// itens da caixa automaticamente ao ler o código dela. Só caixas
// finalizadas têm codigo_barras preenchido.
router.get('/codigo/:codigo', auth, async (req, res) => {
  try {
    const [[caixa]] = await db.query(
      'SELECT * FROM v_caixas_resumo WHERE codigo_barras = ?',
      [req.params.codigo]
    );
    if (!caixa) return res.status(404).json({ erro: 'Nenhuma caixa encontrada com esse código.' });

    const [itens] = await db.query(
      'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
      [caixa.id]
    );

    res.json({ ...caixa, itens });
  } catch (err) {
    console.error('[GET /caixas/codigo/:codigo]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixa.' });
  }
});

// GET /api/caixas/:id — detalhe com itens e responsáveis envolvidos
router.get('/:id', auth, async (req, res) => {
  try {
    const [[caixa]] = await db.query(
      'SELECT * FROM v_caixas_resumo WHERE id = ?',
      [req.params.id]
    );
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });

    const [itens] = await db.query(
      'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
      [req.params.id]
    );

    const responsaveis = [...new Set(itens.map(i => i.responsavel_nome).filter(Boolean))];

    res.json({ ...caixa, itens, responsaveis });
  } catch (err) {
    console.error('[GET /caixas/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar caixa.' });
  }
});

// POST /api/caixas — abrir uma nova caixa (Almoxarifado)
// A caixa nasce com status "aberta" e SEM código de barras — o código
// só é gerado ao finalizar (POST /:id/finalizar). Enquanto aberta, ela
// pode receber mais itens de outros responsáveis via POST /:id/itens.
router.post('/', auth, apenasAlmoxarifado, async (req, res) => {
  try {
    const { responsavel_nome, numero_projeto, observacoes, itens } = req.body;

    if (!responsavelValido(responsavel_nome)) {
      return res.status(400).json({ erro: 'Selecione um responsável válido do Almoxarifado.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'Inclua ao menos um item na caixa.' });
    }
    for (const item of itens) {
      if (!item.codigo_item || !item.descricao || !item.quantidade) {
        return res.status(400).json({ erro: 'Cada item precisa de código, descrição e quantidade.' });
      }
    }

    const conn = await db.getConnection();
    let caixaId;
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO caixas (responsavel_nome, numero_projeto, observacoes, criado_por_perfil)
         VALUES (?, ?, ?, ?)`,
        [responsavel_nome, (numero_projeto || '').trim() || null, observacoes || null, req.usuario.perfil]
      );
      caixaId = result.insertId;

      for (let i = 0; i < itens.length; i++) {
        await conn.query(
          `INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [caixaId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, i + 1]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.status(201).json({ id: caixaId, status: 'aberta', mensagem: 'Caixa salva. Use "Finalizar" quando estiver pronta.' });
  } catch (err) {
    console.error('[POST /caixas]', err.message);
    res.status(500).json({ erro: 'Erro ao salvar caixa.' });
  }
});

// POST /api/caixas/:id/itens — "Alterar": adiciona novos itens a uma
// caixa ainda aberta. Exige o responsável que está adicionando os
// itens nesta rodada — cada rodada fica registrada por item, então
// uma mesma caixa pode ter itens de vários responsáveis diferentes.
router.post('/:id/itens', auth, apenasAlmoxarifado, async (req, res) => {
  try {
    const { responsavel_nome, itens } = req.body;

    if (!responsavelValido(responsavel_nome)) {
      return res.status(400).json({ erro: 'Selecione o responsável que está adicionando os itens.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'Inclua ao menos um item para adicionar.' });
    }
    for (const item of itens) {
      if (!item.codigo_item || !item.descricao || !item.quantidade) {
        return res.status(400).json({ erro: 'Cada item precisa de código, descrição e quantidade.' });
      }
    }

    const [[caixa]] = await db.query('SELECT id, status FROM caixas WHERE id = ?', [req.params.id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (caixa.status !== 'aberta') {
      return res.status(409).json({ erro: 'Esta caixa já foi finalizada e não aceita novos itens.' });
    }

    const [[{ maxOrdem }]] = await db.query(
      'SELECT COALESCE(MAX(ordem), 0) AS maxOrdem FROM caixa_itens WHERE caixa_id = ?',
      [caixa.id]
    );

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < itens.length; i++) {
        await conn.query(
          `INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [caixa.id, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, maxOrdem + i + 1]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    res.json({ mensagem: `${itens.length} ${itens.length === 1 ? 'item adicionado' : 'itens adicionados'} por ${responsavel_nome}.` });
  } catch (err) {
    console.error('[POST /caixas/:id/itens]', err.message);
    res.status(500).json({ erro: 'Erro ao adicionar itens à caixa.' });
  }
});

// POST /api/caixas/:id/finalizar — fecha a caixa: grava a data/hora
// de fechamento e gera o código de barras (pronto para etiqueta).
router.post('/:id/finalizar', auth, apenasAlmoxarifado, async (req, res) => {
  try {
    const [[caixa]] = await db.query('SELECT id, status FROM caixas WHERE id = ?', [req.params.id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (caixa.status !== 'aberta') {
      return res.status(409).json({ erro: 'Esta caixa já foi finalizada.' });
    }

    const [[{ totalItens }]] = await db.query(
      'SELECT COUNT(*) AS totalItens FROM caixa_itens WHERE caixa_id = ?',
      [caixa.id]
    );
    if (!totalItens) {
      return res.status(400).json({ erro: 'Adicione ao menos um item antes de finalizar a caixa.' });
    }

    const codigoBarras = 'CX' + String(caixa.id).padStart(6, '0');
    await db.query(
      `UPDATE caixas SET status = 'fechada', fechado_em = NOW(), codigo_barras = ? WHERE id = ?`,
      [codigoBarras, caixa.id]
    );

    const [[atualizada]] = await db.query('SELECT fechado_em, numero_projeto FROM caixas WHERE id = ?', [caixa.id]);

    res.json({
      id: caixa.id,
      status: 'fechada',
      codigo_barras: codigoBarras,
      fechado_em: atualizada.fechado_em,
      numero_projeto: atualizada.numero_projeto,
      mensagem: 'Caixa finalizada com sucesso.',
    });
  } catch (err) {
    console.error('[POST /caixas/:id/finalizar]', err.message);
    res.status(500).json({ erro: 'Erro ao finalizar caixa.' });
  }
});

// POST /api/caixas/:id/romaneio — gera o PDF do romaneio (itens +
// responsáveis + data de fechamento), envia por e-mail e devolve o
// PDF na resposta para visualização/impressão imediata. Só é
// possível depois de a caixa ter sido finalizada.
router.post('/:id/romaneio', auth, async (req, res) => {
  try {
    const [[caixa]] = await db.query('SELECT * FROM v_caixas_resumo WHERE id = ?', [req.params.id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (caixa.status === 'aberta') {
      return res.status(400).json({ erro: 'Finalize a caixa antes de gerar o romaneio.' });
    }

    const [itens] = await db.query(
      'SELECT * FROM caixa_itens WHERE caixa_id = ? ORDER BY ordem ASC, id ASC',
      [caixa.id]
    );
    const responsaveis = [...new Set(itens.map(i => i.responsavel_nome).filter(Boolean))];

    const pdfBuffer = await gerarRomaneioPDF({ caixa, itens, responsaveis });
    const nomeArquivo = `romaneio-${caixa.codigo_barras || caixa.id}.pdf`;

    let emailEnviado = false;
    let emailErro = '';
    const destinatarios = (process.env.ROMANEIO_CAIXA_EMAIL_TO || '').trim();
    if (destinatarios) {
      try {
        await enviarEmail({
          to: destinatarios,
          subject: `Romaneio — Caixa ${caixa.codigo_barras || caixa.id}`,
          html: `
            <p>Segue em anexo o romaneio da caixa <strong>${caixa.codigo_barras || ('#' + caixa.id)}</strong>,
            finalizada em ${new Date(caixa.fechado_em).toLocaleString('pt-BR')}.</p>
            <p>Responsável(is): ${responsaveis.join(', ') || '—'}</p>
            <p style="color:#6b7280;font-size:12px">Central Expedição — Burntech Caldeiras (e-mail automático)</p>
          `,
          attachments: [{ filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailEnviado = true;
      } catch (mailErr) {
        emailErro = sanitizarErroHeader(mailErr.message);
        console.error('[POST /caixas/:id/romaneio] falha ao enviar e-mail:', mailErr.message);
      }
    } else {
      emailErro = 'ROMANEIO_CAIXA_EMAIL_TO nao configurado no servidor.';
      console.warn('[POST /caixas/:id/romaneio] ROMANEIO_CAIXA_EMAIL_TO não configurado — e-mail não enviado.');
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.set('X-Email-Enviado', emailEnviado ? 'true' : 'false');
    if (emailErro) res.set('X-Email-Erro', emailErro);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /caixas/:id/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio.' });
  }
});

module.exports = router;
