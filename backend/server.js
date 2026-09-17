require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes             = require('./routes/auth');
const carregamentosRoutes    = require('./routes/carregamentos');
const caixasRoutes           = require('./routes/caixas');
const romaneiosProducaoRoutes = require('./routes/romaneiosProducao');
const romaneioImpressaoRoutes = require('./routes/romaneioImpressao');
const desenhosTecnicosRoutes  = require('./routes/desenhosTecnicos');
const itensMateriaisRoutes   = require('./routes/itensMateriais');
const etiquetasRoutes        = require('./routes/etiquetas');
const { verificarConexao } = require('./mail');
const { getPool: getPoolErp } = require('./dbErp');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Middlewares globais ───────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  // Permite que o frontend leia os cabeçalhos customizados que informam
  // se o e-mail do romaneio foi enviado com sucesso, e por quê não, quando
  // for o caso (ver POST /api/caixas/:id/romaneio, /api/romaneios-producao/:id/romaneio
  // e /api/carregamentos/:id/romaneio), e se a impressão automática na
  // laser foi enfileirada (só o romaneio de Produção, por enquanto).
  exposedHeaders: ['X-Email-Enviado', 'X-Email-Erro', 'X-Impressao-Enfileirada', 'X-Impressao-Erro'],
}));
app.use(express.json());

// Rate limit geral
// "skip" isenta os agentes locais (print-agent/ e desenho-agent/) deste
// limite — eles ficam consultando várias filas (/api/etiquetas,
// /api/romaneio-impressao, /api/desenhos-tecnicos) a cada poucos
// segundos, 24/7, e por estarem todos na mesma rede da empresa
// (mesmo IP público de saída) somados facilmente passavam dos 300
// pedidos em 15 minutos — sem essa isenção, os agentes de impressão
// paravam de funcionar sozinhos com HTTP 429 depois de um tempo. Só
// isenta quem manda a chave certa (X-Agent-Key === AGENT_API_KEY);
// quem não tem a chave continua sob o limite normal, então isso não
// abre brecha pra abuso.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => Boolean(process.env.AGENT_API_KEY) && req.headers['x-agent-key'] === process.env.AGENT_API_KEY,
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
app.use('/api/romaneios-producao', romaneiosProducaoRoutes);
app.use('/api/romaneio-impressao', romaneioImpressaoRoutes);
app.use('/api/desenhos-tecnicos', desenhosTecnicosRoutes);
app.use('/api/itens-materiais', itensMateriaisRoutes);
app.use('/api/etiquetas',      etiquetasRoutes);

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
// disparar nenhum e-mail — útil para diagnosticar ROMANEIO_CAIXA_EMAIL_TO /
// ROMANEIO_CARREGAMENTO_EMAIL_TO "não enviado" sem precisar gerar um
// romaneio de verdade.
// Ex.: curl http://localhost:3002/api/health/mail
app.get('/api/health/mail', async (req, res) => {
  try {
    await verificarConexao();
    res.json({ status: 'ok', mensagem: 'Conexão SMTP autenticada com sucesso.' });
  } catch (err) {
    res.status(500).json({ status: 'erro', mensagem: err.message });
  }
});

// Testa a conexão com o banco do ERP (SQL Server) configurada em
// backend/.env (ERP_DB_*), sem depender de logar no app — útil para
// diagnosticar catálogo de itens fora do ar.
// Ex.: curl http://localhost:3002/api/health/erp
app.get('/api/health/erp', async (req, res) => {
  try {
    const pool = await getPoolErp();
    await pool.request().query('SELECT TOP 1 1 AS ok FROM PRO_PRODUTO');
    res.json({ status: 'ok', mensagem: 'Conexão com o ERP (SQL Server) e leitura de PRO_PRODUTO OK.' });
  } catch (err) {
    res.status(500).json({ status: 'erro', mensagem: err.message });
  }
});

// ── Inicia servidor ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n📦 Burntech Expedição — API rodando na porta ${PORT}`);
  console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}\n`);
});
