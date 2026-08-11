require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes           = require('./routes/auth');
const carregamentosRoutes  = require('./routes/carregamentos');
const caixasRoutes         = require('./routes/caixas');
const itensMateriaisRoutes = require('./routes/itensMateriais');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  // Permite que o frontend leia o cabeçalho customizado que informa
  // se o e-mail do romaneio foi enviado com sucesso (ver POST /api/caixas/:id/romaneio).
  exposedHeaders: ['X-Email-Enviado'],
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

// ── Inicia servidor ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n📦 Burntech Expedição — API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});
