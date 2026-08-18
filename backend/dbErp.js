// Conexão somente-leitura com o banco de dados do ERP (SQL Server),
// usada exclusivamente para consultar o catálogo de itens/materiais
// na tabela PRO_PRODUTO. Esta aplicação nunca grava nesse banco —
// o cadastro dos produtos é feito e mantido de fora, no próprio ERP.
const sql = require('mssql');
require('dotenv').config();

const config = {
  server:   process.env.ERP_DB_HOST,
  port:     parseInt(process.env.ERP_DB_PORT) || 1433,
  database: process.env.ERP_DB_NAME,
  user:     process.env.ERP_DB_USER,
  password: process.env.ERP_DB_PASSWORD,
  options: {
    // A maioria dos SQL Server on-premise não usa certificado TLS
    // válido publicamente — trustServerCertificate evita erro de
    // handshake nesses casos. ERP_DB_ENCRYPT=true liga a criptografia
    // da conexão (recomendado se o servidor exigir).
    encrypt: /^true$/i.test(process.env.ERP_DB_ENCRYPT || 'false'),
    trustServerCertificate: true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 15000,
  requestTimeout: 15000,
};

let poolPromise = null;

// Reaproveita uma única pool de conexões entre requisições. Se a conexão
// cair ou falhar, descarta a promise para permitir uma nova tentativa na
// próxima chamada, em vez de ficar travado num pool morto.
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
