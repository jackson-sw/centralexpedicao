const router = require('express').Router();
const db     = require('../db');
const { auth, apenasPintura } = require('../middleware/auth');

// Fila de busca + impressão automática de TODOS os desenhos técnicos
// de uma estrutura — perfil Pintura, tela "Imprimir Desenhos". Ao
// contrário de desenho_tecnico_impressao_fila (backend/routes/
// desenhosTecnicos.js), que busca o desenho de UM item específico
// dentro de uma caixa do perfil Produção, aqui não existe caixa nem
// caixa_item: só projeto + estrutura completa (ex.: "250492-TCR500"),
// e o desenho-agent/ imprime todos os PDFs que encontrar na pasta
// daquela estrutura (ou na subpasta da faixa, se existir uma).

// Formato do campo "Projeto" da tela de Pintura: projeto + hífen +
// estrutura completa (3 letras + 3 dígitos), ex.: "250492-TCR500".
// Diferente do PADRAO_CODIGO_DESENHO usado em Produção (backend/routes/
// caixas.js), que aceita qualquer quantidade de dígitos no número da
// peça (e uma posição opcional no final) porque ali o código vem de
// uma etiqueta lida item a item — aqui é digitado à mão, então o
// formato do lado da estrutura fica fixo.
//
// O projeto normalmente tem 6 dígitos (13 caracteres no total), mas
// projetos de REFORMA de uma estrutura já existente têm 8 dígitos (6
// do projeto original + 2 do número da reforma, que não é sempre "01")
// — nesse caso o campo todo tem 15 caracteres, ex.: "19029901-PET005".
const PADRAO_PROJETO_PINTURA = /^(\d{6}(?:\d{2})?)-([A-Za-z]{3}\d{3})$/;

// Bloqueio: só o agente local (desenho-agent/) pode consultar/concluir
// esta fila — mesma chave fixa dos demais agentes (AGENT_API_KEY).
function apenasAgente(req, res, next) {
  const chave = req.headers['x-agent-key'];
  if (!process.env.AGENT_API_KEY || chave !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ erro: 'Chave do agente de impressão inválida ou não configurada.' });
  }
  next();
}

// POST /api/desenhos-tecnicos-lote — perfil Pintura pede a impressão
// de todos os desenhos de uma estrutura. Só enfileira o pedido; quem
// busca e imprime de verdade é o desenho-agent/, de forma assíncrona
// (não há retorno de "quantos foram impressos" nesta resposta).
router.post('/', auth, apenasPintura, async (req, res) => {
  try {
    const projetoInformado = String(req.body.projeto || '').trim().toUpperCase();
    const match = PADRAO_PROJETO_PINTURA.exec(projetoInformado);
    if (!match) {
      return res.status(400).json({ erro: 'Informe o projeto no formato NNNNNN-LLLnnn (ou NNNNNNNN-LLLnnn para reforma), ex.: 250492-TCR500 ou 19029901-PET005.' });
    }
    const [, projeto, estrutura] = match;

    const [result] = await db.query(
      `INSERT INTO desenho_tecnico_lote_fila (projeto, estrutura, solicitado_por_perfil) VALUES (?, ?, 'pintura')`,
      [projeto, estrutura]
    );

    res.status(201).json({
      id: result.insertId,
      mensagem: `Solicitação enviada — os desenhos de ${projeto}-${estrutura} serão buscados e impressos em instantes.`,
    });
  } catch (err) {
    console.error('[POST /desenhos-tecnicos-lote]', err.message);
    res.status(500).json({ erro: 'Erro ao solicitar impressão dos desenhos.' });
  }
});

// GET /api/desenhos-tecnicos-lote/pendentes — usado só pelo desenho-agent.
router.get('/pendentes', apenasAgente, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, projeto, estrutura, criado_em
       FROM desenho_tecnico_lote_fila
       WHERE status = 'pendente'
       ORDER BY criado_em ASC
       LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /desenhos-tecnicos-lote/pendentes]', err.message);
    res.status(500).json({ erro: 'Erro ao buscar fila de impressão em lote.' });
  }
});

// POST /api/desenhos-tecnicos-lote/:id/concluido — agente reporta
// quantos desenhos encontrou e imprimiu (e quantos, dentre esses,
// falharam ao imprimir — ver comentário em desenho-agent/agent.js).
router.post('/:id/concluido', apenasAgente, async (req, res) => {
  try {
    const quantidadeImpressa = Number(req.body?.quantidade_impressa) || 0;
    const quantidadeErro = Number(req.body?.quantidade_erro) || 0;
    await db.query(
      `UPDATE desenho_tecnico_lote_fila
       SET status = 'concluido', quantidade_impressa = ?, quantidade_erro = ?, concluido_em = NOW()
       WHERE id = ?`,
      [quantidadeImpressa, quantidadeErro, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /desenhos-tecnicos-lote/:id/concluido]', err.message);
    res.status(500).json({ erro: 'Erro ao concluir impressão em lote.' });
  }
});

// POST /api/desenhos-tecnicos-lote/:id/erro — agente reporta falha
// (pasta do projeto/estrutura não encontrada, ambígua, nenhum PDF
// encontrado, etc. — ver desenho-agent/agent.js).
router.post('/:id/erro', apenasAgente, async (req, res) => {
  try {
    const msg = String(req.body?.erro || 'Erro desconhecido').slice(0, 300);
    await db.query(
      `UPDATE desenho_tecnico_lote_fila SET status = 'erro', erro_msg = ? WHERE id = ?`,
      [msg, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /desenhos-tecnicos-lote/:id/erro]', err.message);
    res.status(500).json({ erro: 'Erro ao registrar falha da impressão em lote.' });
  }
});

module.exports = router;
