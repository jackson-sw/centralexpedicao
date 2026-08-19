const router = require('express').Router();
const db     = require('../db');
const { auth, apenasExpedicao, apenasEmCampo } = require('../middleware/auth');
const { enviarEmail, sanitizarErroHeader } = require('../mail');
const { gerarRomaneioCarregamentoPDF } = require('../pdf/romaneioCarregamento');
const { gerarRomaneioFaltantesPDF } = require('../pdf/romaneioFaltantes');

// Rótulo exibido em telas, PDFs e e-mails: "numero_projeto-sequencial_projeto"
// (ex.: "240092-1", "240092-2") — distingue carregamentos repetidos para o
// mesmo número de projeto (ex.: duas cargas em dias diferentes).
function labelProjeto(carregamento) {
  return `${carregamento.numero_projeto}-${carregamento.sequencial_projeto}`;
}

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

    // Sequencial por projeto: 1 para o primeiro carregamento deste
    // numero_projeto, 2 para o segundo, etc. — permite carregamentos
    // repetidos do mesmo projeto (ex.: em dias diferentes) sem
    // sobrescrever o controle. A UNIQUE KEY (numero_projeto,
    // sequencial_projeto) é a garantia final contra corrida entre
    // duas requisições simultâneas para o mesmo projeto; se isso
    // acontecer, tentamos de novo com o próximo número disponível.
    let carregamentoId;
    let sequencialProjeto;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const [[{ total }]] = await conn.query(
        'SELECT COUNT(*) AS total FROM carregamentos WHERE numero_projeto = ? FOR UPDATE',
        [numero_projeto]
      );
      sequencialProjeto = total + 1;
      try {
        const [result] = await conn.query(
          `INSERT INTO carregamentos (tipo, responsavel_nome, numero_projeto, sequencial_projeto, placa, cidade_destino, observacoes, criado_por_perfil)
           VALUES ('carregamento', ?, ?, ?, ?, ?, ?, ?)`,
          [responsavel_nome, numero_projeto, sequencialProjeto, placa, cidade_destino, observacoes || null, req.usuario.perfil]
        );
        carregamentoId = result.insertId;
        break;
      } catch (dupErr) {
        if (dupErr.code === 'ER_DUP_ENTRY' && tentativa < 2) continue;
        throw dupErr;
      }
    }

    const caixaIdsUsadas = new Set();

    for (let i = 0; i < itens.length; i++) {
      const caixaId = itens[i].caixa_id || null;
      const caixaItemId = itens[i].caixa_item_id || null;
      if (caixaId) caixaIdsUsadas.add(caixaId);

      await conn.query(
        `INSERT INTO carregamento_itens (carregamento_id, caixa_id, caixa_item_id, codigo_item, descricao, quantidade, ordem)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [carregamentoId, caixaId, caixaItemId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, i + 1]
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
    res.status(201).json({
      id: carregamentoId,
      numero_projeto,
      sequencial_projeto: sequencialProjeto,
      mensagem: 'Carregamento registrado com sucesso.',
    });
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

    // Responsável de cada linha:
    //  - item herdado de uma caixa já aberta (caixa_item_id preenchido —
    //    formato antigo, itens expandidos individualmente): quem colocou
    //    aquele item específico na caixa;
    //  - linha representando a caixa inteira (caixa_id preenchido, sem
    //    caixa_item_id — formato atual): em branco, o Almoxarifado já
    //    controla os responsáveis internamente por caixa;
    //  - item avulso (sem caixa nenhuma): responsável do carregamento.
    // Origem segue a mesma lógica: código da caixa só quando o item veio
    // individualmente dela; em branco na linha-resumo da caixa; "Expedição"
    // para avulso.
    const [itens] = await db.query(
      `SELECT ci.*,
              CASE WHEN ci.caixa_item_id IS NOT NULL THEN cx.codigo_barras
                   WHEN ci.caixa_id IS NOT NULL THEN NULL
                   ELSE NULL END AS caixa_codigo,
              CASE WHEN ci.caixa_item_id IS NOT NULL THEN cxi.responsavel_nome
                   WHEN ci.caixa_id IS NOT NULL THEN NULL
                   ELSE c.responsavel_nome END AS responsavel_item
       FROM carregamento_itens ci
       LEFT JOIN caixas cx ON cx.id = ci.caixa_id
       LEFT JOIN caixa_itens cxi ON cxi.id = ci.caixa_item_id
       JOIN carregamentos c ON c.id = ci.carregamento_id
       WHERE ci.carregamento_id = ?
       ORDER BY ci.ordem ASC, ci.id ASC`,
      [carregamento.id]
    );

    const pdfBuffer = await gerarRomaneioCarregamentoPDF({ carregamento, itens });
    const nomeArquivo = `romaneio-carregamento-${String(labelProjeto(carregamento)).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    let emailEnviado = false;
    let emailErro = '';
    const destinatarios = (process.env.ROMANEIO_CARREGAMENTO_EMAIL_TO || '').trim();
    if (destinatarios) {
      try {
        await enviarEmail({
          to: destinatarios,
          subject: `Romaneio — Carregamento #${labelProjeto(carregamento)}`,
          html: `
            <p>Segue em anexo o romaneio do carregamento <strong>#${labelProjeto(carregamento)}</strong>,
            placa <strong>${carregamento.placa || '—'}</strong>, destino ${carregamento.cidade_destino},
            registrado em ${new Date(carregamento.criado_em).toLocaleString('pt-BR')}.</p>
            <p style="color:#6b7280;font-size:12px">Central Expedição — Burntech Caldeiras (e-mail automático)</p>
          `,
          attachments: [{ filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailEnviado = true;
      } catch (mailErr) {
        emailErro = sanitizarErroHeader(mailErr.message);
        console.error('[POST /carregamentos/:id/romaneio] falha ao enviar e-mail:', mailErr.message);
      }
    } else {
      emailErro = 'ROMANEIO_CARREGAMENTO_EMAIL_TO nao configurado no servidor.';
      console.warn('[POST /carregamentos/:id/romaneio] ROMANEIO_CARREGAMENTO_EMAIL_TO não configurado — e-mail não enviado.');
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.set('X-Email-Enviado', emailEnviado ? 'true' : 'false');
    if (emailErro) res.set('X-Email-Erro', emailErro);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /carregamentos/:id/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio.' });
  }
});

// ── DESEMBARQUE (perfil Em Campo) ──────────────────────────────
// Conferência item a item, na chegada, dos materiais que saíram no
// carregamento. Cada item confirmado grava desembarcado_em; o
// carregamento em si só muda de status quando o Salvar é acionado
// (POST .../finalizar) — até lá fica "pendente" mesmo com itens já
// conferidos, então dá pra fechar a tela e retomar depois sem perder
// o que já foi lido.

// PUT /api/carregamentos/:id/desembarque/itens/:itemId — confirma ou
// desfaz a conferência de um item específico. Usado tanto pelo scanner
// (que resolve o item pelo código no frontend e chama isso pelo id)
// quanto pelo toque manual na lista pra corrigir engano.
router.put('/:id/desembarque/itens/:itemId', auth, apenasEmCampo, async (req, res) => {
  try {
    const confirmado = req.body.confirmado !== false; // default true

    const [[item]] = await db.query(
      'SELECT * FROM carregamento_itens WHERE id = ? AND carregamento_id = ?',
      [req.params.itemId, req.params.id]
    );
    if (!item) return res.status(404).json({ erro: 'Item não pertence a este carregamento.' });

    await db.query(
      'UPDATE carregamento_itens SET desembarcado_em = ? WHERE id = ?',
      [confirmado ? new Date() : null, item.id]
    );

    res.json({ id: item.id, confirmado });
  } catch (err) {
    console.error('[PUT /carregamentos/:id/desembarque/itens/:itemId]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar item do desembarque.' });
  }
});

// POST /api/carregamentos/:id/desembarque/finalizar — fecha a tela de
// desembarque (botão "Salvar"). Permite salvar mesmo com itens
// faltando — nesse caso o status fica "parcial" em vez de "concluido".
router.post('/:id/desembarque/finalizar', auth, apenasEmCampo, async (req, res) => {
  try {
    const responsavel_nome = (req.body.responsavel_nome || '').trim();
    if (!responsavel_nome) {
      return res.status(400).json({ erro: 'Informe o responsável pelo desembarque.' });
    }

    const [[carregamento]] = await db.query('SELECT id FROM carregamentos WHERE id = ?', [req.params.id]);
    if (!carregamento) return res.status(404).json({ erro: 'Carregamento não encontrado.' });

    const [[{ totalItens, totalConferidos }]] = await db.query(
      `SELECT COUNT(*) AS totalItens, COUNT(desembarcado_em) AS totalConferidos
       FROM carregamento_itens WHERE carregamento_id = ?`,
      [req.params.id]
    );
    const status = totalConferidos >= totalItens && totalItens > 0 ? 'concluido' : 'parcial';

    await db.query(
      `UPDATE carregamentos
       SET desembarque_status = ?, desembarque_responsavel = ?, desembarque_em = NOW()
       WHERE id = ?`,
      [status, responsavel_nome, req.params.id]
    );

    res.json({
      status,
      total_itens: totalItens,
      total_conferidos: totalConferidos,
      faltantes: totalItens - totalConferidos,
      mensagem: status === 'concluido'
        ? 'Desembarque salvo — todos os itens conferidos.'
        : `Desembarque salvo com ${totalItens - totalConferidos} ${totalItens - totalConferidos === 1 ? 'item pendente' : 'itens pendentes'}.`,
    });
  } catch (err) {
    console.error('[POST /carregamentos/:id/desembarque/finalizar]', err.message);
    res.status(500).json({ erro: 'Erro ao salvar desembarque.' });
  }
});

// POST /api/carregamentos/:id/desembarque/romaneio — gera e envia por
// e-mail o PDF com os itens ainda não conferidos, no estado em que a
// conferência estiver no momento (não precisa ter clicado Salvar
// antes) — útil pra avisar a Expedição/logística de faltas assim que
// percebidas, mesmo com o desembarque ainda em andamento.
router.post('/:id/desembarque/romaneio', auth, apenasEmCampo, async (req, res) => {
  try {
    const [[carregamento]] = await db.query('SELECT * FROM v_carregamentos_resumo WHERE id = ?', [req.params.id]);
    if (!carregamento) return res.status(404).json({ erro: 'Carregamento não encontrado.' });

    const [itens] = await db.query(
      `SELECT ci.*, cx.codigo_barras AS caixa_codigo
       FROM carregamento_itens ci
       LEFT JOIN caixas cx ON cx.id = ci.caixa_id
       WHERE ci.carregamento_id = ?
       ORDER BY ci.ordem ASC, ci.id ASC`,
      [req.params.id]
    );
    const itensFaltantes = itens.filter((i) => !i.desembarcado_em);
    const responsavelDesembarque = (req.body.responsavel_nome || carregamento.desembarque_responsavel || '').trim();

    const pdfBuffer = await gerarRomaneioFaltantesPDF({
      carregamento,
      itensFaltantes,
      totalItens: itens.length,
      responsavelDesembarque,
    });
    const nomeArquivo = `romaneio-faltantes-${String(labelProjeto(carregamento)).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    let emailEnviado = false;
    let emailErro = '';
    const destinatarios = (process.env.ROMANEIO_CARREGAMENTO_EMAIL_TO || '').trim();
    if (destinatarios) {
      try {
        await enviarEmail({
          to: destinatarios,
          subject: itensFaltantes.length
            ? `Itens faltantes — Carregamento #${labelProjeto(carregamento)}`
            : `Desembarque conferido — Carregamento #${labelProjeto(carregamento)}`,
          html: `
            <p>${itensFaltantes.length
              ? `Faltam <strong>${itensFaltantes.length}</strong> de ${itens.length} itens conferir no desembarque`
              : `Todos os ${itens.length} itens foram conferidos no desembarque`
            } do carregamento <strong>#${labelProjeto(carregamento)}</strong>,
            placa <strong>${carregamento.placa || '—'}</strong>, destino ${carregamento.cidade_destino}.</p>
            <p style="color:#6b7280;font-size:12px">Central Expedição — Burntech Caldeiras (e-mail automático)</p>
          `,
          attachments: [{ filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailEnviado = true;
      } catch (mailErr) {
        emailErro = sanitizarErroHeader(mailErr.message);
        console.error('[POST /carregamentos/:id/desembarque/romaneio] falha ao enviar e-mail:', mailErr.message);
      }
    } else {
      emailErro = 'ROMANEIO_CARREGAMENTO_EMAIL_TO nao configurado no servidor.';
      console.warn('[POST /carregamentos/:id/desembarque/romaneio] ROMANEIO_CARREGAMENTO_EMAIL_TO não configurado — e-mail não enviado.');
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.set('X-Email-Enviado', emailEnviado ? 'true' : 'false');
    if (emailErro) res.set('X-Email-Erro', emailErro);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /carregamentos/:id/desembarque/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio de faltantes.' });
  }
});

module.exports = router;
