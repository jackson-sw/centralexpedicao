-- ============================================================
-- Fila de impressão em lote de desenhos técnicos — perfil Pintura.
--
-- Rode isto se o seu banco já existe e ainda não tem a tabela
-- `desenho_tecnico_lote_fila` — instalações novas já recebem essa
-- tabela direto do banco_de_dados.sql. Não mexe em nenhuma tabela
-- existente (inclusive não tem relação com desenho_tecnico_impressao_fila,
-- que continua sendo só do perfil Produção).
-- ============================================================
USE burntech_expedicao;

CREATE TABLE IF NOT EXISTS desenho_tecnico_lote_fila (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  projeto                VARCHAR(10)  NOT NULL,
  estrutura              VARCHAR(20)  NOT NULL,
  solicitado_por_perfil  ENUM('pintura') NOT NULL DEFAULT 'pintura',
  status                 ENUM('pendente', 'concluido', 'erro') NOT NULL DEFAULT 'pendente',
  quantidade_impressa    INT UNSIGNED NULL,
  quantidade_erro        INT UNSIGNED NULL,
  erro_msg               VARCHAR(300) NULL,
  criado_em              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em           DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_desenho_tecnico_lote_fila_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
