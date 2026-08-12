-- ============================================================
-- Central Expedição — Correção
-- A view v_carregamentos_resumo ficou desatualizada quando o campo
-- "placa" foi adicionado à tabela carregamentos (alter_carregamentos_placa.sql
-- adicionou a coluna, mas não recriou a view) — por isso a placa
-- salvava normalmente, mas não aparecia em lugar nenhum que lê a
-- view: histórico, detalhe do carregamento e romaneio em PDF.
--
-- Este script só recria a view — é seguro rodar mesmo que você já
-- tenha executado alter_carregamentos_placa.sql antes.
-- ============================================================

USE burntech_expedicao;

CREATE OR REPLACE VIEW v_carregamentos_resumo AS
SELECT
  c.id,
  c.tipo,
  c.responsavel_nome,
  c.numero_projeto,
  c.placa,
  c.cidade_destino,
  c.observacoes,
  c.status,
  c.criado_por_perfil,
  c.criado_em,
  c.atualizado_em,
  COUNT(ci.id)                    AS total_itens,
  COALESCE(SUM(ci.quantidade), 0) AS quantidade_total
FROM carregamentos c
LEFT JOIN carregamento_itens ci ON ci.carregamento_id = c.id
GROUP BY c.id;
