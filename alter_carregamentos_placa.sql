-- ============================================================
-- Central Expedição — Migração incremental
-- Adiciona o campo "Placa" (placa do caminhão) ao carregamento.
-- Execute manualmente em bancos já provisionados.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE carregamentos
  ADD COLUMN placa VARCHAR(10) NOT NULL DEFAULT '' AFTER numero_projeto;

-- Registros já existentes não têm essa informação — ficam com placa
-- vazia. Se quiser, atualize manualmente os carregamentos antigos:
--   UPDATE carregamentos SET placa = 'ABC-1234' WHERE id = ...;
ALTER TABLE carregamentos
  ALTER COLUMN placa DROP DEFAULT;

ALTER TABLE carregamentos
  ADD KEY idx_carregamentos_placa (placa);
