-- ============================================================
-- Central Expedição — Migração
-- Fila de busca + impressão automática do desenho técnico (PDF) de um
-- item lido no romaneio de Produção, quando o código do item bate com
-- o padrão "NNNNNN-LLLddd" (6 dígitos do projeto + hífen + 3 letras da
-- estrutura + número), ex.: "250013-DGA109".
--
-- O backend só registra o pedido aqui — quem busca o arquivo no
-- servidor de arquivos (D:\Engenharia\...) e imprime é o
-- desenho-agent/, direto na impressora local, sem passar o PDF pelo
-- backend.
--
-- Rode este script em bancos já provisionados. Instalações novas já
-- recebem tudo isso direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

CREATE TABLE IF NOT EXISTS desenho_tecnico_impressao_fila (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  romaneio_item_id  INT UNSIGNED NOT NULL,
  codigo_item       VARCHAR(100) NOT NULL,
  projeto           VARCHAR(10)  NOT NULL,
  estrutura         VARCHAR(20)  NOT NULL,
  status            ENUM('pendente', 'impresso', 'erro') NOT NULL DEFAULT 'pendente',
  erro_msg          VARCHAR(300) NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_desenho_tecnico_impressao_fila_status (status),
  KEY idx_desenho_tecnico_impressao_fila_item (romaneio_item_id),
  CONSTRAINT fk_desenho_tecnico_impressao_fila_item
    FOREIGN KEY (romaneio_item_id) REFERENCES romaneio_producao_itens(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
