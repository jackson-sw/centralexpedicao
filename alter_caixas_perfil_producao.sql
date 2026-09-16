-- ============================================================
-- Central Expedição — Migração
--
-- Este arquivo passou por um redesenho: a primeira versão dele tinha
-- adicionado o valor 'producao' ao ENUM caixas.criado_por_perfil, pra
-- o perfil Produção montar caixa na MESMA tabela do Almoxarifado.
-- Isso nunca chegou a ser publicado (a versão anterior deste arquivo
-- não foi rodada em nenhum banco em produção).
--
-- A versão atual segue outro caminho: o perfil Produção tem sua
-- PRÓPRIA estrutura (romaneios_producao / romaneio_producao_itens),
-- com numeração própria (PROD-00001, PROD-00002, ...) e sem etiqueta
-- física — só gera romaneio. Ver banco_de_dados.sql,
-- backend/routes/romaneiosProducao.js e backend/constants.js
-- (PRODUCAO_RESPONSAVEIS).
--
-- Rode este script em bancos já provisionados (instalações novas já
-- recebem tudo isso direto de banco_de_dados.sql). Se você chegou a
-- rodar a versão antiga deste arquivo (com 'producao' no ENUM de
-- caixas) em algum banco, o primeiro ALTER abaixo reverte isso com
-- segurança, desde que não existam caixas com criado_por_perfil =
-- 'producao' gravadas (não deveria haver, já que o recurso nunca foi
-- publicado).
-- ============================================================

USE burntech_expedicao;

-- Reverte caixas.criado_por_perfil para o conjunto original, caso a
-- versão antiga desta migração tenha sido aplicada neste banco.
ALTER TABLE caixas
  MODIFY COLUMN criado_por_perfil
    ENUM('expedicao', 'em_campo', 'almoxarifado')
    NOT NULL DEFAULT 'almoxarifado';

-- Estrutura própria do perfil Produção.
CREATE TABLE IF NOT EXISTS romaneios_producao (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo            VARCHAR(20)  NULL,
  status            ENUM('aberto', 'fechado') NOT NULL DEFAULT 'aberto',
  responsavel_nome  VARCHAR(150) NOT NULL,
  numero_projeto    VARCHAR(50)  NULL,
  observacoes       VARCHAR(500) NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fechado_em        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_romaneios_producao_codigo (codigo),
  KEY idx_romaneios_producao_status (status),
  KEY idx_romaneios_producao_criado_em (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS romaneio_producao_itens (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  romaneio_id      INT UNSIGNED NOT NULL,
  codigo_item      VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255) NOT NULL,
  quantidade       DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  responsavel_nome VARCHAR(150) NOT NULL,
  ordem            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_romaneio_producao_itens_romaneio_id (romaneio_id),
  KEY idx_romaneio_producao_itens_codigo_item (codigo_item),
  CONSTRAINT fk_romaneio_producao_itens_romaneio
    FOREIGN KEY (romaneio_id) REFERENCES romaneios_producao(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_romaneios_producao_resumo AS
SELECT
  r.id,
  r.codigo,
  r.status,
  r.responsavel_nome,
  r.numero_projeto,
  r.observacoes,
  r.criado_em,
  r.fechado_em,
  COUNT(ri.id)                    AS total_itens,
  COALESCE(SUM(ri.quantidade), 0) AS quantidade_total
FROM romaneios_producao r
LEFT JOIN romaneio_producao_itens ri ON ri.romaneio_id = r.id
GROUP BY r.id;
