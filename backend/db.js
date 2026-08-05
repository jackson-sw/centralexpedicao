const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'burntech_expedicao',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '-03:00',
  charset:  'utf8mb4',
});

// Garante que cada conexão do pool use Brasília (UTC-3).
// O 'timezone' acima afeta apenas a serialização JS↔MySQL;
// o SET time_zone abaixo corrige o CURRENT_TIMESTAMP gerado pelo servidor.
pool.on('connection', connection => {
  connection.query("SET time_zone = '-03:00'");
});

module.exports = pool;
