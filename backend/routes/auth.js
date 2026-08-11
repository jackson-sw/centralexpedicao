const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');

const NOMES_PERFIL = {
  expedicao:    'Expedição',
  em_campo:     'Em Campo',
  almoxarifado: 'Almoxarifado',
};

const HASH_ENV = {
  expedicao:    'EXPEDICAO_PASSWORD_HASH',
  em_campo:     'EM_CAMPO_PASSWORD_HASH',
  almoxarifado: 'ALMOXARIFADO_PASSWORD_HASH',
};

// POST /api/auth/login — { perfil: 'expedicao' | 'em_campo' | 'almoxarifado', senha }
router.post('/login', async (req, res) => {
  try {
    const { perfil, senha } = req.body;

    if (!perfil || !HASH_ENV[perfil]) {
      return res.status(400).json({ erro: 'Perfil inválido.' });
    }
    if (!senha) {
      return res.status(400).json({ erro: 'Senha obrigatória.' });
    }

    const hashEnv = process.env[HASH_ENV[perfil]];
    if (!hashEnv) {
      return res.status(503).json({ erro: `Senha do perfil ${NOMES_PERFIL[perfil]} não configurada no servidor.` });
    }

    const senhaOk = await bcrypt.compare(senha, hashEnv);
    if (!senhaOk) {
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      { perfil, nome: NOMES_PERFIL[perfil] },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({ token, perfil, nome: NOMES_PERFIL[perfil] });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// POST /api/auth/admin-login — senha exclusiva do painel administrativo (/admin)
router.post('/admin-login', async (req, res) => {
  try {
    const { senha } = req.body;
    if (!senha) return res.status(400).json({ erro: 'Senha obrigatória.' });

    const hashEnv = process.env.ADMIN_PASSWORD_HASH;
    if (!hashEnv) {
      return res.status(503).json({ erro: 'Senha admin não configurada no servidor. Defina ADMIN_PASSWORD_HASH no .env.' });
    }

    const senhaOk = await bcrypt.compare(senha, hashEnv);
    if (!senhaOk) return res.status(401).json({ erro: 'Senha incorreta.' });

    const token = jwt.sign(
      { perfil: 'admin', nome: 'Admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({ token, perfil: 'admin', nome: 'Admin' });
  } catch (err) {
    console.error('[admin-login]', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

module.exports = router;
