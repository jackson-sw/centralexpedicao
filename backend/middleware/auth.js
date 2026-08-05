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
function apenasExpedicao(req, res, next) {
  if (req.usuario?.perfil !== 'expedicao') {
    return res.status(403).json({ erro: 'Acesso restrito ao perfil Expedição.' });
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

module.exports = { auth, apenasExpedicao, apenasAdmin };
