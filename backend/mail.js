const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter SMTP já configurado e pronto para uso.
// Nenhuma rota dispara e-mail automaticamente ainda — fica disponível
// para quando notificações (ex.: novo carregamento registrado) forem
// solicitadas em uma próxima etapa.
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

module.exports = transporter;
