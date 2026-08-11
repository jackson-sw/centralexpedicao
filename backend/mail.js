const nodemailer = require('nodemailer');
require('dotenv').config();

const MAIL_PORT = parseInt(process.env.MAIL_PORT) || 587;

// Transporter SMTP — usado pelo envio do romaneio (caixa e carregamento)
// e disponível para futuras notificações.
//
// secure/requireTLS dependem da porta:
//   465 → TLS implícito desde a conexão (secure: true)
//   587 (padrão) → conexão em texto plano que faz upgrade via STARTTLS
//                  (secure: false, requireTLS: true)
// Antes disto era hardcoded para porta 587 e a comparação de
// MAIL_USE_TLS era sensível a maiúsculas/minúsculas ("True" exato) —
// ambos podiam causar falha silenciosa de conexão dependendo do provedor.
const transporter = nodemailer.createTransport({
  host:       process.env.MAIL_SERVER,
  port:       MAIL_PORT,
  secure:     MAIL_PORT === 465,
  requireTLS: MAIL_PORT !== 465 && /^true$/i.test(process.env.MAIL_USE_TLS || 'true'),
  auth: {
    user: process.env.MAIL_USERNAME,
    pass: process.env.MAIL_PASSWORD,
  },
  tls: { rejectUnauthorized: false },
});

// Helper genérico de envio, usado pelas rotas da API.
// attachments segue o formato do Nodemailer: [{ filename, content, contentType }]
async function enviarEmail({ to, subject, html, attachments }) {
  return transporter.sendMail({
    from: process.env.MAIL_DEFAULT_SENDER,
    to,
    subject,
    html,
    attachments,
  });
}

// Testa a conexão/autenticação SMTP sem enviar nenhum e-mail.
// Usado por GET /api/health/mail (ver server.js) para diagnosticar
// problemas de configuração direto pelo navegador/curl, sem precisar
// gerar um romaneio só para descobrir o erro.
async function verificarConexao() {
  await transporter.verify();
}

// Sanitiza a mensagem de erro do envio para caber em um cabeçalho HTTP
// (X-Email-Erro) — remove quebras de linha e limita o tamanho.
function sanitizarErroHeader(mensagem) {
  return String(mensagem || 'Erro desconhecido').replace(/[\r\n]+/g, ' ').slice(0, 200);
}

module.exports = { transporter, enviarEmail, verificarConexao, sanitizarErroHeader };
