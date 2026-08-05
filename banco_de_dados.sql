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
-- Tabela: carregamento_itens
-- Relação um-para-muitos: cada carregamento tem N itens/materiais.
-- ------------------------------------------------------------
CREATE TABLE carregamento_itens (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  carregamento_id  INT UNSIGNED NOT NULL,
  codigo_item      VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255) NOT NULL,
  quantidade       DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ordem            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_itens_carregamento_id (carregamento_id),
  KEY idx_itens_codigo_item (codigo_item),
  CONSTRAINT fk_itens_carregamento
    FOREIGN KEY (carregamento_id) REFERENCES carregamentos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- Dados iniciais: nenhum. Os perfis de acesso (Expedição / Em Campo)
-- são autenticados por senha fixa via hash bcrypt em backend/.env
-- (EXPEDICAO_PASSWORD_HASH / EM_CAMPO_PASSWORD_HASH), não há tabela
-- de usuários — mesmo modelo do perfil "central" no Central Logística.
-- ------------------------------------------------------------
