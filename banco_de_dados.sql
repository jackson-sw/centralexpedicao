-- ============================================================
-- Central Expedição — Burntech Caldeiras
-- DDL completo do MySQL (execução única para provisionar o banco)
-- ============================================================

CREATE DATABASE IF NOT EXISTS burntech_expedicao
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE burntech_expedicao;

-- ------------------------------------------------------------
-- Tabela: carregamentos
-- Registro principal de um carregamento (ou, futuramente,
-- descarregamento) da expedição.
-- ------------------------------------------------------------
CREATE TABLE carregamentos (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo              ENUM('carregamento', 'descarregamento') NOT NULL DEFAULT 'carregamento',
  responsavel_nome  VARCHAR(150) NOT NULL,
  numero_projeto    VARCHAR(50)  NOT NULL,
  cidade_destino    VARCHAR(150) NOT NULL,
  observacoes       VARCHAR(500) NULL,
  status            ENUM('em_andamento', 'concluido', 'cancelado') NOT NULL DEFAULT 'concluido',
  criado_por_perfil ENUM('expedicao', 'em_campo') NOT NULL DEFAULT 'expedicao',
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_carregamentos_numero_projeto (numero_projeto),
  KEY idx_carregamentos_criado_em (criado_em),
  KEY idx_carregamentos_status (status),
  KEY idx_carregamentos_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- Tabela: carregamento_itens
-- Relação um-para-muitos: cada carregamento tem N itens/materiais.
-- "caixa_id" fica preenchido quando o item veio de uma caixa lida
-- por código de barras (vínculo de rastreabilidade); NULL para
-- itens avulsos digitados/escaneados individualmente.
-- ------------------------------------------------------------
CREATE TABLE carregamento_itens (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  carregamento_id  INT UNSIGNED NOT NULL,
  caixa_id         INT UNSIGNED NULL,
  codigo_item      VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255) NOT NULL,
  quantidade       DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ordem            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_itens_carregamento_id (carregamento_id),
  KEY idx_itens_codigo_item (codigo_item),
  KEY idx_itens_caixa_id (caixa_id),
  CONSTRAINT fk_itens_carregamento
    FOREIGN KEY (carregamento_id) REFERENCES carregamentos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_itens_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ------------------------------------------------------------
-- View: v_carregamentos_resumo
-- Lista de carregamentos com contagem de itens e quantidade total,
-- usada na tela de histórico sem precisar de N+1 queries.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_carregamentos_resumo AS
SELECT
  c.id,
  c.tipo,
  c.responsavel_nome,
  c.numero_projeto,
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

-- ------------------------------------------------------------
-- Tabela: itens_materiais
-- Catálogo mestre de materiais, mantido pelo painel administrativo
-- (/admin). Apenas código (único) e descrição.
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

-- ------------------------------------------------------------
-- Dados iniciais: nenhum. Os perfis de acesso (Expedição / Em Campo /
-- Admin) são autenticados por senha fixa via hash bcrypt em
-- backend/.env (EXPEDICAO_PASSWORD_HASH / EM_CAMPO_PASSWORD_HASH /
-- ADMIN_PASSWORD_HASH), não há tabela de usuários — mesmo modelo do
-- perfil "central" no Central Logística.
-- ------------------------------------------------------------
