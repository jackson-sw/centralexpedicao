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
  id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo                     ENUM('carregamento', 'descarregamento') NOT NULL DEFAULT 'carregamento',
  responsavel_nome         VARCHAR(150) NOT NULL,
  numero_projeto           VARCHAR(50)  NOT NULL,
  placa                    VARCHAR(10)  NOT NULL,
  cidade_destino           VARCHAR(150) NOT NULL,
  observacoes              VARCHAR(500) NULL,
  status                   ENUM('em_andamento', 'concluido', 'cancelado') NOT NULL DEFAULT 'concluido',
  criado_por_perfil        ENUM('expedicao', 'em_campo', 'almoxarifado') NOT NULL DEFAULT 'expedicao',
  -- Desembarque (perfil Em Campo): confere item a item, na chegada,
  -- os materiais que saíram no carregamento. "pendente" = ninguém
  -- ainda salvou o desembarque; "parcial" = salvo, mas faltou item;
  -- "concluido" = salvo com todos os itens conferidos.
  desembarque_status       ENUM('pendente', 'parcial', 'concluido') NOT NULL DEFAULT 'pendente',
  desembarque_responsavel  VARCHAR(150) NULL,
  desembarque_em           DATETIME NULL,
  criado_em                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_carregamentos_numero_projeto (numero_projeto),
  KEY idx_carregamentos_placa (placa),
  KEY idx_carregamentos_criado_em (criado_em),
  KEY idx_carregamentos_status (status),
  KEY idx_carregamentos_tipo (tipo),
  KEY idx_carregamentos_desembarque_status (desembarque_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Tabela: caixas
-- Uma caixa é aberta no almoxarifado e pode ser preenchida aos
-- poucos, por mais de um responsável, enquanto estiver "aberta".
-- Ao ser finalizada ("Finalizar"), passa para "fechada", grava
-- fechado_em e ganha um código de barras próprio (gerado a partir
-- do id), pronto para impressão. Quando essa caixa é lida dentro
-- de um carregamento, o status muda para "expedida".
-- ------------------------------------------------------------
CREATE TABLE caixas (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_barras     VARCHAR(30)  NULL,
  status            ENUM('aberta', 'fechada', 'expedida') NOT NULL DEFAULT 'aberta',
  responsavel_nome  VARCHAR(150) NOT NULL,
  observacoes       VARCHAR(500) NULL,
  criado_por_perfil ENUM('expedicao', 'em_campo', 'almoxarifado') NOT NULL DEFAULT 'almoxarifado',
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fechado_em        DATETIME NULL,
  expedido_em       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_caixas_codigo_barras (codigo_barras),
  KEY idx_caixas_status (status),
  KEY idx_caixas_criado_em (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Tabela: caixa_itens
-- Relação um-para-muitos: cada caixa contém N materiais pequenos,
-- cada um com seu próprio código de barras individual. Guarda quem
-- (responsavel_nome) adicionou cada item — uma caixa "aberta" pode
-- receber itens de mais de um responsável ao longo do tempo.
-- ------------------------------------------------------------
CREATE TABLE caixa_itens (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  caixa_id         INT UNSIGNED NOT NULL,
  codigo_item      VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255) NOT NULL,
  quantidade       DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  responsavel_nome VARCHAR(150) NOT NULL,
  ordem            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  caixa_item_id    INT UNSIGNED NULL,
  codigo_item      VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255) NOT NULL,
  quantidade       DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  ordem            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- Preenchido pelo perfil Em Campo ao conferir o item na chegada
  -- (fluxo de Desembarque). NULL = ainda não conferido/descarregado.
  desembarcado_em  DATETIME NULL,
  criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_itens_carregamento_id (carregamento_id),
  KEY idx_itens_codigo_item (codigo_item),
  KEY idx_itens_caixa_id (caixa_id),
  KEY idx_itens_caixa_item_id (caixa_item_id),
  CONSTRAINT fk_itens_carregamento
    FOREIGN KEY (carregamento_id) REFERENCES carregamentos(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_itens_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  CONSTRAINT fk_itens_caixa_item
    FOREIGN KEY (caixa_item_id) REFERENCES caixa_itens(id)
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
  c.fechado_em,
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

-- ------------------------------------------------------------
-- NÃO existe mais uma tabela "itens_materiais" neste banco.
-- O catálogo de itens/materiais passou a ser lido em tempo real do
-- banco do ERP (SQL Server, tabela PRO_PRODUTO — ver backend/dbErp.js
-- e backend/routes/itensMateriais.js), configurado via ERP_DB_* em
-- backend/.env. Instalações antigas que ainda têm a tabela local
-- podem removê-la com alter_remover_itens_materiais.sql (opcional).
-- ------------------------------------------------------------
-- Dados iniciais: nenhum. Os perfis de acesso (Expedição / Em Campo /
-- Almoxarifado / Admin) são autenticados por senha fixa via hash
-- bcrypt em backend/.env (EXPEDICAO_PASSWORD_HASH /
-- EM_CAMPO_PASSWORD_HASH / ALMOXARIFADO_PASSWORD_HASH /
-- ADMIN_PASSWORD_HASH), não há tabela de usuários — mesmo modelo do
-- perfil "central" no Central Logística.
-- ------------------------------------------------------------
