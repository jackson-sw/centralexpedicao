-- ============================================================
-- Central Expedição — Migração
-- Adiciona o campo "numero_projeto" à tabela caixas, preenchido
-- pelo Almoxarifado ao criar/finalizar a caixa, para que apareça
-- na etiqueta impressa (junto com a data/hora de fechamento, que
-- já existia na coluna caixas.fechado_em).
--
-- Rode este script em bancos já provisionados. Instalações novas
-- já recebem a coluna direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE caixas
  ADD COLUMN numero_projeto VARCHAR(50) NULL AFTER responsavel_nome;

CREATE OR REPLACE VIEW v_caixas_resumo AS
SELECT
  c.id,
  c.codigo_barras,
  c.status,
  c.responsavel_nome,
  c.numero_projeto,
  c.observacoes,
  c.criado_por_perfil,
  c.criado_em,
  c.fechado_em,
  c.expedido_em,
  COUNT(ci.id)                    AS total_itens,
  COALESCE(SUM(ci.quantidade), 0) AS quantidade_total
FROM caixas c
LEFT JOIN caixa_itens ci ON ci.caixa_id = c.id
GROUP BY c.id;
