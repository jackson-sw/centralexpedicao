-- ============================================================
-- Central Expedição — Migração incremental
-- Adiciona o campo "Quantidade" ao catálogo de itens/materiais
-- (painel administrativo /admin).
-- Execute manualmente em bancos já provisionados.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE itens_materiais
  ADD COLUMN quantidade DECIMAL(10,2) NOT NULL DEFAULT 1.00 AFTER descricao;
