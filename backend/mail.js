const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter SMTP — usado hoje pelo envio do romaneio da caixa
// (backend/routes/caixas.js) e disponível para futuras notificações.
const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_SERVER,
  port:   parseInt(process.env.MAIL_PORT) || 587,
  secure: false,
  requireTLS: process.env.MAIL_USE_TLS === 'True',
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

module.exports = { transporter, enviarEmail };
