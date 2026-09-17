const router = require('express').Router();
const db     = require('../db');
const { auth, apenasMontagemCaixa } = require('../middleware/auth');
const { RESPONSAVEIS_POR_PERFIL } = require('../constants');
const { enviarEmail, sanitizarErroHeader } = require('../mail');
const { montarPdfRomaneioCaixa } = require('../services/romaneioCaixa');

// Almoxarifado, Expedição e Produção compartilham esta mesma tabela e
// fluxo (ver RESPONSAVEIS_POR_PERFIL em constants.js) — cada perfil só
// tem sua própria lista de nomes válidos. Valida contra a lista de
// quem está logado agora, não de quem abriu a caixa originalmente (uma
// caixa pode receber itens de responsáveis diferentes ao longo do
// tempo, inclusive de outro perfil, ver rota POST /:id/itens).
function responsavelValido(nome, perfil) {
  const lista = RESPONSAVEIS_POR_PERFIL[perfil] || [];
  return typeof nome === 'string' && lista.includes(nome.trim());
}

// Reconhece códigos de item no formato "NNNNNN-LLLddd" — 6 dígitos do
// número do projeto, hífen, 3 letras da estrutura + número da peça
// (ex.: "250013-DGA109"). Só o perfil Produção lê itens nesse formato
// (estrutura de engenharia) — os demais perfis usam código de
// material do ERP, que não bate com este padrão. Itens que não batem
// simplesmente não têm desenho técnico pra buscar — ver desenho-agent/.
const PADRAO_CODIGO_DESENHO = /^(\d{6})-([A-Za-z]{3}\d+)$/;

// Enfileira a busca+impressão automática do desenho técnico (PDF) de
// um item recém-salvo/editado do perfil Produção, só quando o código
// bate com o padrão acima. Best-effort: nunca lança erro pra fora —
// uma falha aqui não pode derrubar o salvamento do item em si. Retorna
// true quando conseguiu enfileirar — usado também pela reimpressão
// manual (POST /:id/reimprimir-desenhos) pra contar quantos itens
// entraram na fila.
async function enfileirarDesenhoTecnicoSeAplicavel(caixaItemId, codigoItem) {
  const match = PADRAO_CODIGO_DESENHO.exec((codigoItem || '').trim());
  if (!match) return false;
  const [, projeto, estrutura] = match;
  try {
    await db.query(
      `INSERT INTO desenho_tecnico_impressao_fila (caixa_item_id, codigo_item, projeto, estrutura) VALUES (?, ?, ?, ?)`,
      [caixaItemId, codigoItem.trim(), projeto, estrutura.toUpperCase()]
    );
    return true;
  } catch (err) {
    console.error('[desenho-tecnico] falha ao enfileirar busca para item', caixaItemId, ':', err.message);
    return false;
  }
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

// POST /api/caixas — abrir uma nova caixa (Almoxarifado, Expedição ou
// Produção). A caixa nasce com status "aberta" e SEM código de barras
// — o código só é gerado ao finalizar (POST /:id/finalizar). Enquanto
// aberta, ela pode receber mais itens de outros responsáveis via POST
// /:id/itens. O código de barras (CX + id) sai direto do
// AUTO_INCREMENT da tabela caixas — como é uma tabela só, compartilhada
// pelos três perfis, a numeração segue uma sequência única independente
// de quem criou cada caixa (não existe uma sequência separada por
// perfil).
router.post('/', auth, apenasMontagemCaixa, async (req, res) => {
  try {
    const { responsavel_nome, numero_projeto, observacoes, itens } = req.body;

    if (!responsavelValido(responsavel_nome, req.usuario.perfil)) {
      return res.status(400).json({ erro: 'Selecione um responsável válido.' });
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
    let itensIds;
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO caixas (responsavel_nome, numero_projeto, observacoes, criado_por_perfil)
         VALUES (?, ?, ?, ?)`,
        [responsavel_nome, (numero_projeto || '').trim() || null, observacoes || null, req.usuario.perfil]
      );
      caixaId = result.insertId;

      itensIds = [];
      for (let i = 0; i < itens.length; i++) {
        const [itemResult] = await conn.query(
          `INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [caixaId, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, i + 1]
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

    // Busca/impressão automática de desenho técnico — só Produção lê
    // itens no formato de estrutura de engenharia (ver
    // PADRAO_CODIGO_DESENHO acima). Fire-and-forget: nunca atrasa nem
    // derruba a resposta desta rota.
    if (req.usuario.perfil === 'producao') {
      for (let i = 0; i < itens.length; i++) {
        await enfileirarDesenhoTecnicoSeAplicavel(itensIds[i], itens[i].codigo_item);
      }
    }

    res.status(201).json({ id: caixaId, status: 'aberta', itens_ids: itensIds, mensagem: 'Caixa salva. Use "Finalizar" quando estiver pronta.' });
  } catch (err) {
    console.error('[POST /caixas]', err.message);
    res.status(500).json({ erro: 'Erro ao salvar caixa.' });
  }
});

// POST /api/caixas/:id/itens — "Alterar": adiciona novos itens a uma
// caixa ainda aberta. Exige o responsável que está adicionando os
// itens nesta rodada — cada rodada fica registrada por item, então
// uma mesma caixa pode ter itens de vários responsáveis diferentes.
router.post('/:id/itens', auth, apenasMontagemCaixa, async (req, res) => {
  try {
    const { responsavel_nome, itens } = req.body;

    if (!responsavelValido(responsavel_nome, req.usuario.perfil)) {
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
    // COALESCE(MAX(...), 0) volta do mysql2 como STRING, não number — sem
    // este Number(), "maxOrdem + i + 1" vira concatenação de texto em vez
    // de soma (ex.: "101" + 0 + 1 = "1011" em vez de 102), inflando o
    // valor a cada "Alterar" até estourar o limite da coluna (SMALLINT
    // UNSIGNED, máx. 65535) e travar novas alterações na caixa.
    const proximoOrdem = Number(maxOrdem) || 0;

    const conn = await db.getConnection();
    let itensIds;
    try {
      await conn.beginTransaction();
      itensIds = [];
      for (let i = 0; i < itens.length; i++) {
        const [itemResult] = await conn.query(
          `INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, responsavel_nome, ordem)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [caixa.id, itens[i].codigo_item, itens[i].descricao, itens[i].quantidade, responsavel_nome, proximoOrdem + i + 1]
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

    if (req.usuario.perfil === 'producao') {
      for (let i = 0; i < itens.length; i++) {
        await enfileirarDesenhoTecnicoSeAplicavel(itensIds[i], itens[i].codigo_item);
      }
    }

    res.json({ itens_ids: itensIds, mensagem: `${itens.length} ${itens.length === 1 ? 'item adicionado' : 'itens adicionados'} por ${responsavel_nome}.` });
  } catch (err) {
    console.error('[POST /caixas/:id/itens]', err.message);
    res.status(500).json({ erro: 'Erro ao adicionar itens à caixa.' });
  }
});

// PUT /api/caixas/:caixaId/itens/:itemId — edita um item já salvo
// (botão "Confirmar" reenviando depois de uma correção manual no
// código/descrição/quantidade). Só funciona enquanto a caixa estiver
// aberta; não mexe no responsável do item (fica o de quando foi
// criado).
router.put('/:caixaId/itens/:itemId', auth, apenasMontagemCaixa, async (req, res) => {
  try {
    const { codigo_item, descricao, quantidade } = req.body;
    if (!codigo_item || !descricao || !quantidade) {
      return res.status(400).json({ erro: 'Código, descrição e quantidade são obrigatórios.' });
    }

    const [[caixa]] = await db.query('SELECT id, status FROM caixas WHERE id = ?', [req.params.caixaId]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (caixa.status !== 'aberta') {
      return res.status(409).json({ erro: 'Esta caixa já foi finalizada e não aceita alterações.' });
    }

    // Guarda o código de antes da edição — só reenfileira a busca do
    // desenho técnico (perfil Produção) se o código realmente mudou,
    // pra não reimprimir à toa numa correção só de quantidade/descrição.
    const [[itemAntes]] = await db.query(
      'SELECT codigo_item FROM caixa_itens WHERE id = ? AND caixa_id = ?',
      [req.params.itemId, caixa.id]
    );
    if (!itemAntes) return res.status(404).json({ erro: 'Item não pertence a esta caixa.' });

    const [result] = await db.query(
      'UPDATE caixa_itens SET codigo_item = ?, descricao = ?, quantidade = ? WHERE id = ? AND caixa_id = ?',
      [codigo_item, descricao, quantidade, req.params.itemId, caixa.id]
    );
    if (!result.affectedRows) return res.status(404).json({ erro: 'Item não pertence a esta caixa.' });

    if (req.usuario.perfil === 'producao' && itemAntes.codigo_item.trim() !== codigo_item.trim()) {
      await enfileirarDesenhoTecnicoSeAplicavel(Number(req.params.itemId), codigo_item);
    }

    res.json({ id: Number(req.params.itemId), mensagem: 'Item atualizado.' });
  } catch (err) {
    console.error('[PUT /caixas/:caixaId/itens/:itemId]', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar item.' });
  }
});

// POST /api/caixas/:id/finalizar — fecha a caixa: grava a data/hora
// de fechamento e gera o código de barras (pronto para etiqueta).
router.post('/:id/finalizar', auth, apenasMontagemCaixa, async (req, res) => {
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
//
// Caixas do perfil Produção (caixa.criado_por_perfil === 'producao')
// têm dois comportamentos extras, automáticos, disparados junto com
// este mesmo clique em "🧾 Romaneio" — nenhum dos dois existe para
// caixas de Almoxarifado/Expedição:
//   1. Impressão automática do romaneio numa impressora a laser (papel
//      A4), via fila própria (romaneio_impressao_fila) — ver seção
//      "Impressão automática do romaneio de Produção" no README.
//   2. Reenfileiramento da busca/impressão do desenho técnico de todos
//      os itens da caixa (mesma lógica do botão manual "📐 Reimprimir
//      Desenhos" abaixo) — garante que o desenho sai sempre que o
//      romaneio é (re)gerado, sem depender de lembrar de clicar no
//      botão manual à parte.
router.post('/:id/romaneio', auth, async (req, res) => {
  try {
    const [[caixaStatus]] = await db.query('SELECT status, criado_por_perfil FROM caixas WHERE id = ?', [req.params.id]);
    if (!caixaStatus) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    if (caixaStatus.status === 'aberta') {
      return res.status(400).json({ erro: 'Finalize a caixa antes de gerar o romaneio.' });
    }

    const dados = await montarPdfRomaneioCaixa(req.params.id);
    if (!dados) return res.status(404).json({ erro: 'Caixa não encontrada.' });
    const { caixa, itens, responsaveis, pdfBuffer } = dados;
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
            finalizada em ${new Date(caixa.fechado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>
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

    if (caixaStatus.criado_por_perfil === 'producao') {
      // 1) Impressão automática na laser (papel A4), no mesmo
      // computador-ponte do perfil Almoxarifado (ver print-agent/) —
      // só enfileira o pedido aqui; quem imprime de verdade é o
      // agente local, que baixa o PDF de novo via GET
      // /api/romaneio-impressao/:id/pdf (mesma lógica de
      // montarPdfRomaneioCaixa, não reaproveita este buffer).
      let impressaoEnfileirada = false;
      let impressaoErro = '';
      const impressora = (process.env.IMPRESSORA_ROMANEIO_NOME || '').trim();
      if (impressora) {
        try {
          await db.query(
            `INSERT INTO romaneio_impressao_fila (caixa_id, impressora) VALUES (?, ?)`,
            [caixa.id, impressora]
          );
          impressaoEnfileirada = true;
        } catch (filaErr) {
          impressaoErro = sanitizarErroHeader(filaErr.message);
          console.error('[POST /caixas/:id/romaneio] falha ao enfileirar impressão:', filaErr.message);
        }
      } else {
        impressaoErro = 'IMPRESSORA_ROMANEIO_NOME nao configurado no servidor.';
        console.warn('[POST /caixas/:id/romaneio] IMPRESSORA_ROMANEIO_NOME não configurado — impressão não enfileirada.');
      }
      res.set('X-Impressao-Enfileirada', impressaoEnfileirada ? 'true' : 'false');
      if (impressaoErro) res.set('X-Impressao-Erro', impressaoErro);

      // 2) Reenfileira a busca/impressão do desenho técnico de TODOS
      // os itens da caixa — mesma ação do botão manual "📐 Reimprimir
      // Desenhos" (ver rota abaixo), disparada automaticamente aqui
      // pra não depender de lembrar de clicar em outro botão.
      let desenhosEnfileirados = 0;
      for (const item of itens) {
        const ok = await enfileirarDesenhoTecnicoSeAplicavel(item.id, item.codigo_item);
        if (ok) desenhosEnfileirados++;
      }
      res.set('X-Desenhos-Enfileirados', String(desenhosEnfileirados));
    }

    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /caixas/:id/romaneio]', err.message);
    res.status(500).json({ erro: 'Erro ao gerar romaneio.' });
  }
});

// POST /api/caixas/:id/reimprimir-desenhos — reenfileira a busca+
// impressão do desenho técnico de TODOS os itens da caixa que batem
// com o padrão de código (ver PADRAO_CODIGO_DESENHO), de novo. Só
// existe pra Produção (é o único perfil cujos itens têm desenho
// técnico) — clicar em "🧾 Romaneio" de novo (reimpressão) não reenvia
// os desenhos, só o PDF do romaneio em si. Ação manual e explícita:
// reimprime mesmo que o desenho daquele item já tenha sido impresso
// com sucesso antes.
router.post('/:id/reimprimir-desenhos', auth, async (req, res) => {
  try {
    if (req.usuario?.perfil !== 'producao') {
      return res.status(403).json({ erro: 'Acesso restrito ao perfil Produção.' });
    }

    const [[caixa]] = await db.query('SELECT id FROM caixas WHERE id = ?', [req.params.id]);
    if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrada.' });

    const [itens] = await db.query(
      'SELECT id, codigo_item FROM caixa_itens WHERE caixa_id = ?',
      [caixa.id]
    );

    let enfileirados = 0;
    for (const item of itens) {
      const ok = await enfileirarDesenhoTecnicoSeAplicavel(item.id, item.codigo_item);
      if (ok) enfileirados++;
    }

    res.json({ enfileirados, total_itens: itens.length });
  } catch (err) {
    console.error('[POST /caixas/:id/reimprimir-desenhos]', err.message);
    res.status(500).json({ erro: 'Erro ao reenfileirar desenhos técnicos.' });
  }
});

module.exports = router;
