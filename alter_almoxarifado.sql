-- ============================================================
-- Central Expedição — Migração incremental
-- Novo perfil de acesso "Almoxarifado" (responsável por montar e
-- fechar as caixas — função que antes ficava no perfil Expedição).
-- Execute manualmente em bancos já provisionados com a versão
-- anterior do banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

-- Inclui 'almoxarifado' como valor possível de criado_por_perfil
-- nas duas tabelas que já guardavam essa coluna.
ALTER TABLE caixas
  MODIFY COLUMN criado_por_perfil ENUM('expedicao', 'em_campo', 'almoxarifado') NOT NULL DEFAULT 'almoxarifado';

ALTER TABLE carregamentos
  MODIFY COLUMN criado_por_perfil ENUM('expedicao', 'em_campo', 'almoxarifado') NOT NULL DEFAULT 'expedicao';

-- Nada além disso: o perfil "Almoxarifado" não tem tabela própria de
-- usuários — assim como Expedição/Em Campo/Admin, a senha é validada
-- por hash bcrypt em backend/.env (ALMOXARIFADO_PASSWORD_HASH).
-- Gere o hash da senha padrão (Almox0987) com:
--   node -e "require('bcrypt').hash('Almox0987',12).then(h=>console.log(h))"
-- e adicione a variável ALMOXARIFADO_PASSWORD_HASH no seu .env.
