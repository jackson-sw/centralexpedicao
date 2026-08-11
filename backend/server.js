require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes           = require('./routes/auth');
const carregamentosRoutes  = require('./routes/carregamentos');
const caixasRoutes         = require('./routes/caixas');
const itensMateriaisRoutes = require('./routes/itensMateriais');
const { verificarConexao } = require('./mail');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  // Permite que o frontend leia os cabeçalhos customizados que informam
  // se o e-mail do romaneio foi enviado com sucesso, e por quê não, quando
  // for o caso (ver POST /api/caixas/:id/romaneio e /api/carregamentos/:id/romaneio).
  exposedHeaders: ['X-Email-Enviado', 'X-Email-Erro'],
}));
app.use(express.json());

// Rate limit geral
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Rate limit mais restrito para login
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' }
}));

// ── Rotas da API ──────────────────────────────────────────────
app.use('/api/auth',           authRoutes);
app.use('/api/carregamentos',  carregamentosRoutes);
app.use('/api/caixas',         caixasRoutes);
app.use('/api/itens-materiais', itensMateriaisRoutes);

// ── Serve o frontend estático em produção ─────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Testa a conexão/autenticação SMTP configurada em backend/.env, sem
// disparar nenhum e-mail — útil para diagnosticar ROMANEIO_EMAIL_TO
// "não enviado" sem precisar gerar um romaneio de verdade.
// Ex.: curl http://localhost:3002/api/health/mail
app.get('/api/health/mail', async (req, res) => {
  try {
    await verificarConexao();
    res.json({ status: 'ok', mensagem: 'Conexão SMTP autenticada com sucesso.' });
  } catch (err) {
    res.status(500).json({ status: 'erro', mensagem: err.message });
  }
});

// ── Inicia servidor ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n📦 Burntech Expedição — API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});
