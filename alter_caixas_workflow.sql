-- ============================================================
-- Central Expedição — Migração incremental
-- Fluxo de caixas com estado "aberta": a caixa pode ser preenchida
-- aos poucos por mais de um responsável (Alterar) antes de ser
-- fechada (Finalizar, que grava a data/hora e gera o código de
-- barras). Execute manualmente em bancos já provisionados.
-- ============================================================

USE burntech_expedicao;

-- 1) Novo status "aberta" (mantém 'fechada'/'expedida' já usados).
--    Caixas já existentes continuam com o status atual — só novas
--    caixas nascerão "abertas" a partir de agora.
ALTER TABLE caixas
  MODIFY COLUMN status ENUM('aberta', 'fechada', 'expedida') NOT NULL DEFAULT 'aberta';

-- 2) Data/hora em que a caixa foi finalizada (distinta de criado_em).
ALTER TABLE caixas
  ADD COLUMN fechado_em DATETIME NULL AFTER criado_em;

-- Backfill: caixas que já estavam fechadas/expedidas antes desta
-- migração nasciam já fechadas na criação — usa criado_em como
-- aproximação da data de fechamento.
UPDATE caixas
   SET fechado_em = criado_em
 WHERE status IN ('fechada', 'expedida')
   AND fechado_em IS NULL;

-- 3) Quem adicionou cada item da caixa (uma caixa "aberta" pode
--    receber itens de mais de um responsável ao longo do tempo).
ALTER TABLE caixa_itens
  ADD COLUMN responsavel_nome VARCHAR(150) NOT NULL DEFAULT '' AFTER quantidade;

-- Backfill: itens já cadastrados herdam o responsável que abriu a
-- caixa (única informação disponível antes desta migração).
UPDATE caixa_itens ci
  JOIN caixas c ON c.id = ci.caixa_id
   SET ci.responsavel_nome = c.responsavel_nome
 WHERE ci.responsavel_nome = '';

ALTER TABLE caixa_itens
  ALTER COLUMN responsavel_nome DROP DEFAULT;
