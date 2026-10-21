-- ============================================================
-- Central Expedição — Campo "equipamento" nas caixas
-- ============================================================
-- Adiciona caixas.equipamento (texto de até 8 caracteres; obrigatório na Nova Caixa, nulo só nas caixas antigas)
-- e atualiza a view v_caixas_resumo para expô-lo.
--
-- Rode uma vez no banco já existente (bancos novos já vêm com o campo
-- em banco_de_dados.sql).
-- ============================================================

ALTER TABLE caixas
  ADD COLUMN equipamento VARCHAR(8) NULL AFTER numero_projeto;

CREATE OR REPLACE VIEW v_caixas_resumo AS
SELECT
  c.id,
  c.codigo_barras,
  c.status,
  c.responsavel_nome,
  c.numero_projeto,
  c.equipamento,
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
