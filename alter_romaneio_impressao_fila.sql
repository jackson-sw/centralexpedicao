-- ============================================================
-- Fila de impressão automática do romaneio (laser A4) — perfil
-- Produção, agora ligada a `caixas` (não mais a `romaneios_producao`,
-- que foi descontinuada — ver migrar_producao_para_caixas.sql).
--
-- Rode isto se o seu banco já passou pela migração de Produção pra
-- caixas/caixa_itens (ou é uma instalação nova a partir de uma versão
-- do banco_de_dados.sql anterior a esta tabela existir) e você quer
-- restaurar a impressão automática do romaneio de Produção numa
-- impressora a laser.
-- ============================================================
CREATE TABLE IF NOT EXISTS romaneio_impressao_fila (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  caixa_id     INT UNSIGNED NOT NULL,
  impressora   VARCHAR(100) NOT NULL,
  status       ENUM('pendente', 'impresso', 'erro') NOT NULL DEFAULT 'pendente',
  erro_msg     VARCHAR(300) NULL,
  criado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  impresso_em  DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_romaneio_impressao_fila_status (status),
  KEY idx_romaneio_impressao_fila_caixa_id (caixa_id),
  CONSTRAINT fk_romaneio_impressao_fila_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
