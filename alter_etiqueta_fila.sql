-- ============================================================
-- Central Expedição — Migração
-- Cria a fila de impressão física de etiquetas (etiqueta_fila),
-- usada pelo novo fluxo de impressão automática: o app enfileira
-- (POST /api/etiquetas) em vez de imprimir pelo navegador, e um
-- agente local (print-agent/) roda no computador ligado às
-- impressoras Argox (uma para o perfil Almoxarifado, outra para o
-- perfil Expedição), consultando a fila e imprimindo silenciosamente.
--
-- Rode este script em bancos já provisionados. Instalações novas já
-- recebem a tabela direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

CREATE TABLE etiqueta_fila (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  caixa_id               INT UNSIGNED NOT NULL,
  impressora             VARCHAR(100) NOT NULL,
  solicitado_por_perfil  ENUM('almoxarifado', 'expedicao') NOT NULL,
  status                 ENUM('pendente', 'impresso', 'erro') NOT NULL DEFAULT 'pendente',
  erro_msg               VARCHAR(300) NULL,
  criado_em              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  impresso_em            DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_etiqueta_fila_status (status),
  KEY idx_etiqueta_fila_caixa_id (caixa_id),
  CONSTRAINT fk_etiqueta_fila_caixa
    FOREIGN KEY (caixa_id) REFERENCES caixas(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
