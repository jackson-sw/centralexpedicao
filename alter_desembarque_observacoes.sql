-- ============================================================
-- Observações opcionais do desembarque (perfil Em Campo).
--
-- Rode isto se o seu banco já existe e ainda não tem a coluna
-- `desembarque_observacoes` em `carregamentos` — instalações novas já
-- recebem essa coluna direto do banco_de_dados.sql.
-- ============================================================
USE burntech_expedicao;

ALTER TABLE carregamentos
  ADD COLUMN desembarque_observacoes TEXT NULL AFTER desembarque_em;

CREATE OR REPLACE VIEW v_carregamentos_resumo AS
SELECT
  c.id,
  c.tipo,
  c.responsavel_nome,
  c.numero_projeto,
  c.sequencial_projeto,
  c.placa,
  c.cidade_destino,
  c.observacoes,
  c.status,
  c.criado_por_perfil,
  c.desembarque_status,
  c.desembarque_responsavel,
  c.desembarque_em,
  c.desembarque_observacoes,
  c.criado_em,
  c.atualizado_em,
  COUNT(ci.id)                                            AS total_itens,
  COALESCE(SUM(ci.quantidade), 0)                         AS quantidade_total,
  COUNT(ci.desembarcado_em)                               AS total_itens_desembarcados
FROM carregamentos c
LEFT JOIN carregamento_itens ci ON ci.carregamento_id = c.id
GROUP BY c.id;
