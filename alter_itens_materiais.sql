-- ============================================================
-- Central Expedição — Alteração incremental
-- Feature: Cadastro de Itens/Materiais (painel administrativo)
--
-- Execute manualmente no banco já provisionado (banco_de_dados.sql).
-- ============================================================

USE burntech_expedicao;

-- ------------------------------------------------------------
-- Tabela: itens_materiais
-- Catálogo mestre de materiais, mantido pelo painel administrativo.
-- Apenas código (identificador do item, normalmente o mesmo valor
-- do código de barras) e descrição.
-- ------------------------------------------------------------
CREATE TABLE itens_materiais (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo        VARCHAR(100) NOT NULL,
  descricao     VARCHAR(255) NOT NULL,
  criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_itens_materiais_codigo (codigo),
  KEY idx_itens_materiais_descricao (descricao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
