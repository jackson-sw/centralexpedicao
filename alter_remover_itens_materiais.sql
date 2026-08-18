-- ============================================================
-- Central Expedição — Limpeza opcional
--
-- O catálogo de itens/materiais deixou de ser mantido neste banco:
-- agora é lido em tempo real direto do ERP (SQL Server, tabela
-- PRO_PRODUTO — ver backend/dbErp.js e backend/routes/itensMateriais.js,
-- configurado via ERP_DB_* em backend/.env). A tabela itens_materiais
-- não é mais usada pela aplicação em nenhuma tela.
--
-- Este script é OPCIONAL: só remova a tabela quando tiver certeza de
-- que não precisa mais dos dados que estavam nela (ela não é mais
-- lida nem escrita pelo sistema de jeito nenhum, então mantê-la só
-- ocupa espaço). Faça um backup antes se tiver dúvida:
--   mysqldump -u root -p burntech_expedicao itens_materiais > backup_itens_materiais.sql
-- ============================================================

USE burntech_expedicao;

DROP TABLE IF EXISTS itens_materiais;
