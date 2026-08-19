-- ============================================================
-- Central Expedição — Migração
-- Adiciona controle de carregamentos repetidos para o mesmo
-- numero_projeto (ex.: duas cargas em dias diferentes para o mesmo
-- projeto). O backend calcula automaticamente sequencial_projeto a
-- cada novo carregamento (1 para o primeiro carregamento daquele
-- projeto, 2 para o segundo, etc.) — exibido como
-- "numero_projeto-sequencial_projeto" (ex.: "240092-1", "240092-2")
-- em telas, PDFs e e-mails de romaneio.
--
-- Carregamentos já existentes recebem sequencial_projeto = 1 por
-- padrão (DEFAULT 1). Se já existir mais de um carregamento para o
-- mesmo numero_projeto numa base antiga, rode a renumeração abaixo
-- (comentada) para preencher a sequência corretamente antes de criar
-- a UNIQUE KEY.
--
-- Rode este script em bancos já provisionados. Instalações novas já
-- recebem a coluna direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE carregamentos
  ADD COLUMN sequencial_projeto SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER numero_projeto;

-- Renumera automaticamente carregamentos pré-existentes do mesmo
-- numero_projeto (ordem cronológica de criação), para não violar a
-- UNIQUE KEY criada em seguida caso a base já tenha duplicidade.
UPDATE carregamentos c
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY numero_projeto ORDER BY criado_em, id) AS novo_seq
  FROM carregamentos
) x ON x.id = c.id
SET c.sequencial_projeto = x.novo_seq;

ALTER TABLE carregamentos
  ADD UNIQUE KEY uq_carregamentos_projeto_sequencial (numero_projeto, sequencial_projeto);

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
  c.criado_em,
  c.atualizado_em,
  COUNT(ci.id)                                            AS total_itens,
  COALESCE(SUM(ci.quantidade), 0)                         AS quantidade_total,
  COUNT(ci.desembarcado_em)                               AS total_itens_desembarcados
FROM carregamentos c
LEFT JOIN carregamento_itens ci ON ci.carregamento_id = c.id
GROUP BY c.id;
