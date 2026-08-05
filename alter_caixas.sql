-- ============================================================
-- Central Expedição — Alteração incremental
-- Feature: Caixas (almoxarifado → pátio) com código de barras
-- próprio, vinculadas a N itens pequenos, e rastreabilidade
-- até o carregamento onde a caixa foi efetivamente usada.
--
-- Execute manualmente no banco já provisionado (banco_de_dados.sql).
-- ============================================================

USE burntech_expedicao;

-- ------------------------------------------------------------
-- Tabela: caixas
-- Uma caixa é montada no almoxarifado com vários itens pequenos.
-- Ao ser salva, já nasce "fechada" e ganha um código de barras
-- próprio (gerado a partir do id), pronto para ser impresso e
-- colado na caixa física. Quando essa caixa é lida dentro de um
-- carregamento, o status muda para "expedida".
-- ------------------------------------------------------------
CREATE TABLE caixas (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_barras     VARCHAR(30)  NULL,
  status            ENUM('fechada', 'expedida') NOT NULL DEFAULT 'fechada',
  responsavel_nome  VARCHAR(150) NOT NULL,
  observacoes       VARCHAR(500) NULL,
  criado_por_perfil ENUM('expedicao', 'em_campo') NOT NULL DEFAULT 'expedicao',
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expedido_em       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_caixas_codigo_barras (codigo_barras),
  KEY idx_caixas_status (status),
  KEY idx_caixas_criado_em (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Tabela: caixa_itens
-- Relação um-para-muitos: cada caixa contém N materiais pequenos,
-- cada um com seu próprio código de barras individual.
-- ------------------------------------------------------------
CREATE TABLE caixa_itens (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  caixa_id    INT UNSIGNED NOT NULL,
  codigo_item VARCHAR(100) NOT NULL,
  descricao   VARCHAR(255) NOT NULL,
  quantidade  DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ordem       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_caixa_itens_caixa_id (caixa_id),
  KEY idx_caixa_itens_codigo_item (codigo_item),
  CONSTRAINT fk_caixa_itens_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Vínculo: um item de carregamento pode ter vindo de uma caixa
-- (quando o código lido no carregamento é o código da caixa, e
-- não de um item avulso). Fica NULL para itens avulsos normais.
-- ------------------------------------------------------------
ALTER TABLE carregamento_itens
  ADD COLUMN caixa_id INT UNSIGNED NULL AFTER carregamento_id,
  ADD KEY idx_carregamento_itens_caixa_id (caixa_id),
  ADD CONSTRAINT fk_carregamento_itens_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- View: v_caixas_resumo
-- Lista de caixas com contagem de itens e quantidade total.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_caixas_resumo AS
SELECT
  c.id,
  c.codigo_barras,
  c.status,
  c.responsavel_nome,
  c.observacoes,
  c.criado_por_perfil,
  c.criado_em,
  c.expedido_em,
  COUNT(ci.id)                    AS total_itens,
  COALESCE(SUM(ci.quantidade), 0) AS quantidade_total
FROM caixas c
LEFT JOIN caixa_itens ci ON ci.caixa_id = c.id
GROUP BY c.id;
