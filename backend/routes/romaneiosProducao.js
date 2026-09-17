const router = require('express').Router();
const db     = require('../db');
const { auth, apenasProducao } = require('../middleware/auth');
const { PRODUCAO_RESPONSAVEIS } = require('../constants');
const { enviarEmail, sanitizarErroHeader } = require('../mail');
const { montarPdfRomaneioProducao } = require('../services/romaneioProducao');

// Estrutura própria do perfil Produção — NÃO usa as tabelas
// caixas/caixa_itens (essas continuam exclusivas de
// Almoxarifado/Expedição, ver backend/routes/caixas.js). Aqui o
// objetivo é só gerar romaneio: não existe etiqueta, código de barras
// físico nem impressora configurada pra este perfil. O "codigo"
// gerado ao finalizar (PROD-00001, PROD-00002, ...) é só um número de
// identificação do romaneio, com sequência própria começando em 1.
function responsavelValido(nome) {
  return typeof nome === 'string' && PRODUCAO_RESPONSAVEIS.includes(nome.trim());
}

// Reconhece códigos de item no formato "NNNNNN-LLLddd" — 6 dígitos do
// número do projeto, hífen, 3 letras da estrutura + número da peça
// (ex.: "250013-DGA109"). Itens que não batem com isso (parafuso,
// material avulso, etc.) simplesmente não têm desenho técnico pra
// buscar — ver desenho-agent/.
const PADRAO_CODIGO_DESENHO = /^(\d{6})-([A-Za-z]{3}\d+)$/;

// Enfileira a busca+impressão automática do desenho técnico (PDF) de
// um item recém-salvo/editado, só quando o código bate com o padrão
// acima. Best-effort: nunca lança erro pra fora — uma falha aqui não
// pode derrubar o salvamento do item em si.
// Retorna true quando conseguiu enfileirar (código bate com o padrão e o
// INSERT deu certo) — usado tanto no fluxo automático (criação/edição de
// item, valor de retorno ignorado) quanto na reimpressão manual (POST
// /:id/reimprimir-desenhos), que precisa contar quantos itens entraram
// na fila pra informar o usuário.
async function enfileirarDesenhoTecnicoSeAplicavel(romaneioItemId, codigoItem) {
  const match = PADRAO_CODIGO_DESENHO.exec((codigoItem || '').trim());
  if (!match) return false;
  const [, projeto, estrutura] = match;
  try {
    await db.query(
      `INSERT INTO desenho_tecnico_impressao_fila (romaneio_item_id, codigo_item, projeto, estrutura) VALUES (?, ?, ?, ?)`,
      [romaneioItemId, codigoItem.trim(), projeto, estrutura.toUpperCase()]
    );
    return true;
  } catch (err) {
    console.error('[desenho-tecnico] falha ao enfileirar busca para item', romaneioItemId, ':', err.message);
    return false;
  }
}

// GET /api/romaneios-producao — histórico (mais recentes primeiro)
router.get('/', auth, apenasProducao, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM v_romaneios_producao_resumo WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY criado_em DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[GET /romaneios-producao]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar romaneios.' });
  }
});

// GET /api/romaneios-producao/:id — detalhe com itens e responsáveis envolvidos
router.get('/:id', auth, apenasProducao, async (req, res) => {
  try {
    const [[romaneio]] = await db.query(
      'SELECT * FROM v_romaneios_producao_resumo WHERE id = ?',
      [req.params.id]
    );
    if (!romaneio) return res.status(404).json({ erro: 'Romaneio não encontrado.' });

    const [itens] = await db.query(
      'SELECT * FROM romaneio_producao_itens WHERE romaneio_id = ? ORDER BY ordem ASC, id ASC',
      [req.params.id]
    );

    const responsaveis = [...new Set(itens.map(i => i.responsavel_nome).filter(Boolean))];

    res.json({ ...romaneio, itens, responsaveis });
  } catch (err) {
    console.error('[GET /romaneios-producao/:id]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar romaneio.' });
  }
});

// POST /api/romaneios-producao — abrir um novo romaneio
// Nasce com status "aberto" e SEM código — o código só é gerado ao
// finalizar (POST /:id/finalizar). Enquanto aberto, pode receber mais
// itens de outros responsáveis via POST /:id/itens.
router.post('/', auth, apenasProducao, async (req, res) => {
  try {
    const { responsavel_nome, numero_projeto, observacoes, itens } = req.body;

    if (!responsavelValido(responsavel_nome)) {
      return res.status(400).json({ erro: 'Selecione um responsável válido.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'Inclua ao menos um item no romaneio.' });
    }
    for (const item of itens) {
      if (!item.codigo_item || !item.descricao || !item.quantidade) {
        return res.status(400).json({ erro: 'Cada item precisa de código, descrição e quantidade.' });
      }
    }

    const conn = await db.getConnection();
    let romaneioId;
    let itensIds;
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO romaneios_producao (responsavel_nome, numero_projeto, observacoes)
         VALUES (?, ?, ?)`,
        [responsavel_nome, (numero_projeto || '').trim() || null, observacoes || null]
      );
      romaneioId = result.insertId;

      itensIds = [];
      for (let i = 0; i < itens.length; i++) {
        const [itemResult] = await conn.query(
          `INSERT INTO romaneio_producao_itens (romaneio_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [romaneioId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, i + 1]
        );
        itensIds.push(itemResult.insertId);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Só depois do commit — a fila referencia romaneio_producao_itens
    // por FK, a linha precisa existir de verdade no banco.
    for (let i = 0; i < itens.length; i++) {
      await enfileirarDesenhoTecnicoSeAplicavel(itensIds[i], itens[i].codigo_item);
    }

    res.status(201).json({ id: romaneioId, status: 'aberto', itens_ids: itensIds, mensagem: 'Romaneio salvo. Use "Finalizar" quando estiver pronto.' });
  } catch (err) {
    console.error('[POST /romaneios-producao]', err.message);
    res.status(500).json({ erro: 'Erro ao salvar romaneio.' });
  }
});

// POST /api/romaneios-producao/:id/itens — "Alterar": adiciona novos
// itens a um romaneio ainda aberto.
router.post('/:id/itens', auth, apenasProducao, async (req, res) => {
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

    const [[romaneio]] = await db.query('SELECT id, status FROM romaneios_producao WHERE id = ?', [req.params.id]);
    if (!romaneio) return res.status(404).json({ erro: 'Romaneio não encontrado.' });
    if (romaneio.status !== 'aberto') {
      return res.status(409).json({ erro: 'Este romaneio já foi finalizado e não aceita novos itens.' });
    }

    const [[{ maxOrdem }]] = await db.query(
      'SELECT COALESCE(MAX(ordem), 0) AS maxOrdem FROM romaneio_producao_itens WHERE romaneio_id = ?',
      [romaneio.id]
    );
    // Ver o mesmo comentário em backend/routes/caixas.js: COALESCE(...)
    // volta como STRING do mysql2 — sem o Number(), a soma vira
    // concatenação de texto.
    const proximoOrdem = Number(maxOrdem) || 0;

    const conn = await db.getConnection();
    let itensIds;
    try {
      await conn.beginTransaction();
      itensIds = [];
      for (let i = 0; i < itens.length; i++) {
        const [itemResult] = await conn.query(
          `INSERT INTO romaneio_producao_itens (romaneio_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [romaneio.id, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, proximoOrdem + i + 1]
        );
        itensIds.push(itemResult.insertId);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    for (let i = 0; i < itens.length; i++) {
      await enfileirarDesenhoTecnicoSeAplicavel(itensIds[i], itens[i].codigo_item);
    }

    res.json({ itens_ids: itensIds, mensagem: `${itens.length} ${itens.length === 1 ? 'item adicionado' : 'itens adicionados'} por ${responsavel_nome}.` });
  } catch (err) {
    console.error('[POST /romaneios-producao/:id/itens]', err.message);
    res.status(500).json({ erro: 'Erro ao adicionar itens ao romaneio.' });
  }
});

// PUT /api/romaneios-producao/:romaneioId/itens/:itemId — edita um
// item já salvo. Só funciona enquanto o romaneio estiver aberto.
router.put('/:romaneioId/itens/:itemId', auth, apenasProducao, async (req, res) => {
  try {
    const { codigo_item, descricao, quantidade } = req.body;
    if (!codigo_item || !descricao || !quantidade) {
      return res.status(400).json({ erro: 'Código, descrição e quantidade são obrigatórios.' });
    }

    const [[romaneio]] = await db.query('SELECT id, status FROM romaneios_producao WHERE id = ?', [req.params.romaneioId]);
    if (!romaneio) return res.status(404).json({ erro: 'Romaneio não encontrado.' });
    if (romaneio.status !== 'aberto') {
      return res.status(409).json({ erro: 'Este romaneio já foi finalizado e não aceita alterações.' });
    }

    const [[itemAntes]] = await db.query(
      'SELECT codigo_item FROM romaneio_producao_itens WHERE id = ? AND romaneio_id = ?',
      [req.params.itemId, romaneio.id]
    );

    const [result] = await db.query(
      'UPDATE romaneio_producao_itens SET codigo_item = ?, descricao = ?, quantidade = ? WHERE id = ? AND romaneio_id = ?',
      [codigo_item, descricao, quantidade, req.params.itemId, romaneio.id]
    );
    if (!result.affectedRows) return res.status(404).json({ erro: 'Item não pertence a este romaneio.' });

    // Só reenfileira a busca do desenho se o código realmente mudou
    // nesta edição — senão toda correção de descrição/quantidade (sem
    // mexer no código) reimprimiria o mesmo desenho de novo.
    if (!itemAntes || itemAntes.codigo_item.trim() !== codigo_item.trim()) {
      await enfileirarDesenhoTecnicoSeAplicavel(Number(req.params.itemId), codigo_item);
    }

    res.json({ id: Number(req.params.itemId), mensagem: 'Item atualizado.' });
  } catch (err) {
    console.error('[PUT /romaneios-producao/:romaneioId/itens/:itemId]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar item.' });
  }
});

// POST /api/romaneios-producao/:id/finalizar — fecha o romaneio:
// grava a data/hora de fechamento e gera o código sequencial próprio
// (PROD-00001, PROD-00002, ...), a partir do AUTO_INCREMENT desta
// tabela — começa em 1 porque a tabela é exclusiva de Produção.
router.post('/:id/finalizar', auth, apenasProducao, async (req, res) => {
  try {
    const [[romaneio]] = await db.query('SELECT id, status FROM romaneios_producao WHERE id = ?', [req.params.id]);
    if (!romaneio) return res.status(404).json({ erro: 'Romaneio não encontrado.' });
    if (romaneio.status !== 'aberto') {
      return res.status(409).json({ erro: 'Este romaneio já foi finalizado.' });
    }

    const [[{ totalItens }]] = await db.query(
      'SELECT COUNT(*) AS totalItens FROM romaneio_producao_itens WHERE romaneio_id = ?',
      [romaneio.id]
    );
    if (!totalItens) {
      return res.status(400).json({ erro: 'Adicione ao menos um item antes de finalizar o romaneio.' });
    }

    const codigo = 'PROD-' + String(romaneio.id).padStart(5, '0');
    await db.query(
      `UPDATE romaneios_producao SET status = 'fechado', fechado_em = NOW(), codigo = ? WHERE id = ?`,
      [codigo, romaneio.id]
    );

    const [[atualizado]] = await db.query('SELECT fechado_em, numero_projeto FROM romaneios_producao WHERE id = ?', [romaneio.id]);

    res.json({
      id: romaneio.id,
      status: 'fechado',
      codigo,
      fechado_em: atualizado.fechado_em,
      numero_projeto: atualizado.numero_projeto,
      mensagem: 'Romaneio finalizado com sucesso.',
    });
  } catch (err) {
    console.error('[POST /romaneios-producao/:id/finalizar]', err.message);
    res.status(500).json({ erro: 'Erro ao finalizar romaneio.' });
  }
});

// POST /api/romaneios-producao/:id/romaneio — gera o PDF do romaneio
// (itens + responsáveis + data de fechamento), envia por e-mail e
// devolve o PDF na resposta. Só é possível depois de finalizado. Não
// existe rota de etiqueta/impressão pra Produção.
router.post('/:id/romaneio', auth, apenasProducao, async (req, res) => {
  try {
    const [[statusRow]] = await db.query('SELECT status FROM romaneios_producao WHERE id = ?', [req.params.id]);
    if (!statusRow) return res.status(404).json({ erro: 'Romaneio não encontrado.' });
    if (statusRow.status === 'aberto') {
      return res.status(400).json({ erro: 'Finalize o romaneio antes de gerar o PDF.' });
    }

    const dados = await montarPdfRomaneioProducao(req.params.id);
    if (!dados) return res.status(404).json({ erro: 'Romaneio não encontrado.' });
    const { romaneio, responsaveis, pdfBuffer } = dados;
    const nomeArquivo = `romaneio-${romaneio.codigo || romaneio.id}.pdf`;

    let emailEnviado = false;
    let emailErro = '';
    const destinatarios = (process.env.ROMANEIO_PRODUCAO_EMAIL_TO || '').trim();
    if (destinatarios) {
      try {
        await enviarEmail({
          to: destinatarios,
          subject: `Romaneio — Produção ${romaneio.codigo || romaneio.id}`,
          html: `
            <p>Segue em anexo o romaneio <strong>${romaneio.codigo || ('#' + romaneio.id)}</strong>,
            finalizado em ${new Date(romaneio.fechado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
            <p>Responsável(is): ${responsaveis.join(', ') || '—'}</p>
            <p style="color:#6b7280;font-size:12px">Central Expedição — Burntech Caldeiras (e-mail automático)</p>
          `,
          attachments: [{ filename: nomeArquivo, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailEnviado = true;
      } catch (mailErr) {
        emailErro = sanitizarErroHeader(mailErr.message);
        console.error('[POST /romaneios-producao/:id/romaneio] falha ao enviar e-mail:', mailErr.message);
      }
    } else {
      emailErro = 'ROMANEIO_PRODUCAO_EMAIL_TO nao configurado no servidor.';
      console.warn('[POST /romaneios-producao/:id/romaneio] ROMANEIO_PRODUCAO_EMAIL_TO não configurado — e-mail não enviado.');
    }

    // Impressão automática na laser (papel A4), no mesmo computador-ponte
    // do perfil Almoxarifado (ver print-agent/) — só enfileira o pedido
    // aqui; quem imprime de verdade é o agente local, que baixa o PDF de
    // novo via GET /api/romaneio-impressao/:id/pdf (mesma lógica de
    // montarPdfRomaneioProducao, não reaproveita este buffer).
    let impressaoEnfileirada = false;
    let impressaoErro = '';
    const impressora = (process.env.IMPRESSORA_ROMANEIO_NOME || '').trim();
    if (impressora) {
      try {
        await db.query(
          `INSERT INTO romaneio_producao_impressao_fila (romaneio_id, impressora) VALUES (?, ?)`,
          [romaneio.id, impressora]
        );
        impressaoEnfileirada = true;
      } catch (filaErr) {
        impressaoErro = sanitizarErroHeader(filaErr.message);
        console.error('[POST /romaneios-producao/:id/romaneio] falha ao enfileirar impressão:', filaErr.message);
      }
    } else {
      impressaoErro = 'IMPRESSORA_ROMANEIO_NOME nao configurado no servidor.';
      console.warn('[POST /romaneios-producao/:id/romaneio] IMPRESSORA_ROMANEIO_NOME não configurado — impressão não enfileirada.');
    }

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.set('X-Email-Enviado', emailEnviado ? 'true' : 'false');
    if (emailErro) res.set('X-Email-Erro', emailErro);
    res.set('X-Impressao-Enfileirada', impressaoEnfileirada ? 'true' : 'false');
    if (impressaoErro) res.set('X-Impressao-Erro', impressaoErro);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /romaneios-producao/:id/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio.' });
  }
});

// POST /api/romaneios-producao/:id/reimprimir-desenhos — reenfileira a
// busca+impressão do desenho técnico de TODOS os itens do romaneio que
// batem com o padrão de código (ver PADRAO_CODIGO_DESENHO), de novo.
// Existe porque o enfileiramento automático só acontece na criação do
// item ou quando o código dele é alterado — clicar em "🧾 Romaneio" de
// novo (reimpressão) não reenvia os desenhos pro desenho-agent, só o
// PDF do romaneio em si. Ação manual e explícita: reimprime mesmo que o
// desenho daquele item já tenha sido impresso com sucesso antes.
router.post('/:id/reimprimir-desenhos', auth, apenasProducao, async (req, res) => {
  try {
    const [[romaneio]] = await db.query('SELECT id FROM romaneios_producao WHERE id = ?', [req.params.id]);
    if (!romaneio) return res.status(404).json({ erro: 'Romaneio não encontrado.' });

    const [itens] = await db.query(
      'SELECT id, codigo_item FROM romaneio_producao_itens WHERE romaneio_id = ?',
      [romaneio.id]
    );

    let enfileirados = 0;
    for (const item of itens) {
      const ok = await enfileirarDesenhoTecnicoSeAplicavel(item.id, item.codigo_item);
      if (ok) enfileirados++;
    }

    res.json({ enfileirados, total_itens: itens.length });
  } catch (err) {
    console.error('[POST /romaneios-producao/:id/reimprimir-desenhos]', err.message);
    res.status(500).json({ erro: 'Erro ao reenfileirar desenhos técnicos.' });
  }
});

module.exports = router;
