const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return res.status(401).json({ erro: 'Token não fornecido.' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

// Bloqueio: só o perfil Expedição pode registrar novos carregamentos.
// O perfil "Em Campo" (por enquanto) tem acesso apenas de leitura.
// "Expedição Administrativo" tem as mesmas telas de Expedição + Em Campo
// (ver frontend), então também passa neste e no próximo bloqueio.
function apenasExpedicao(req, res, next) {
  if (!['expedicao', 'expedicao_administrativo'].includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Acesso restrito ao perfil Expedição.' });
  }
  next();
}

// Bloqueio: quem pode montar/alterar/fechar caixas — Almoxarifado
// (dono original da tela) e Expedição (que também monta caixa quando
// precisa, direto do pátio, usando a mesma lógica/tela). NÃO inclui
// Expedição Administrativo: esse perfil não tem impressora Argox
// configurada (ver permiteImprimirEtiqueta no frontend e
// IMPRESSORA_POR_PERFIL em backend/routes/etiquetas.js), então o botão
// "Nova Caixa" nem aparece pra ele.
function apenasMontagemCaixa(req, res, next) {
  if (!['almoxarifado', 'expedicao'].includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Acesso restrito aos perfis Almoxarifado e Expedição.' });
  }
  next();
}

// Bloqueio: só o perfil Em Campo pode conferir itens no desembarque.
// "Expedição Administrativo" também tem acesso (ver comentário acima).
function apenasEmCampo(req, res, next) {
  if (!['em_campo', 'expedicao_administrativo'].includes(req.usuario?.perfil)) {
    return res.status(403).json({ erro: 'Acesso restrito ao perfil Em Campo.' });
  }
  next();
}

// Bloqueio: só o perfil Admin (painel /admin) pode gerenciar o
// catálogo de itens/materiais.
function apenasAdmin(req, res, next) {
  if (req.usuario?.perfil !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito ao painel administrativo.' });
  }
  next();
}

// Bloqueio: exclusão de item já salvo de um carregamento em andamento
// é uma ação sensível (some do banco de vez), então diferente de
// apenasExpedicao acima, aqui restringimos só ao perfil Expedição
// Administrativo — nem o perfil Expedição comum tem esse botão.
function apenasExpedicaoAdministrativo(req, res, next) {
  if (req.usuario?.perfil !== 'expedicao_administrativo') {
    return res.status(403).json({ erro: 'Acesso restrito ao perfil Expedição Administrativo.' });
  }
  next();
}

module.exports = { auth, apenasExpedicao, apenasMontagemCaixa, apenasEmCampo, apenasAdmin, apenasExpedicaoAdministrativo };
