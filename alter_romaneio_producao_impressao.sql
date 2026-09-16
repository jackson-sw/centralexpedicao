-- ============================================================
-- Central Expedição — Migração
-- Fila de impressão automática do romaneio de Produção numa
-- impressora a laser (papel A4) — roda no mesmo computador-ponte do
-- perfil Almoxarifado (ver print-agent/), só que numa impressora
-- diferente da(s) Argox (configurada em IMPRESSORA_ROMANEIO_NOME no
-- backend/.env).
--
-- Rode este script em bancos já provisionados. Instalações novas já
-- recebem tudo isso direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

CREATE TABLE IF NOT EXISTS romaneio_producao_impressao_fila (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  romaneio_id  INT UNSIGNED NOT NULL,
  impressora   VARCHAR(100) NOT NULL,
  status       ENUM('pendente', 'impresso', 'erro') NOT NULL DEFAULT 'pendente',
  erro_msg     VARCHAR(300) NULL,
  criado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  impresso_em  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_romaneio_producao_impressao_fila_status (status),
  KEY idx_romaneio_producao_impressao_fila_romaneio_id (romaneio_id),
  CONSTRAINT fk_romaneio_producao_impressao_fila_romaneio
    FOREIGN KEY (romaneio_id) REFERENCES romaneios_producao(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
