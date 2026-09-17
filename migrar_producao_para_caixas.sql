-- ============================================================
-- Migração: perfil Produção passa a usar caixas/caixa_itens
-- ============================================================
-- Contexto: até aqui, o perfil Produção tinha sua própria estrutura,
-- separada (romaneios_producao / romaneio_producao_itens), sem
-- etiqueta nem código de barras físico, e uma impressão automática
-- do romaneio numa laser A4 à parte. A partir de agora, Produção
-- passa a ser IDÊNTICO a Almoxarifado: mesmas tabelas (caixas/
-- caixa_itens), mesma numeração de código de barras (CXxxxxxx),
-- mesma impressora de etiqueta (a do Almoxarifado). A única diferença
-- que continua existindo é a impressão automática de desenho técnico
-- (ver backend/routes/caixas.js e desenho-agent/).
--
-- Este script:
--   1. Amplia os ENUMs de perfil em `caixas` e `etiqueta_fila` para
--      aceitar 'producao'.
--   2. Copia cada romaneio de Produção existente para `caixas` (e cada
--      item para `caixa_itens`), preservando responsável, projeto,
--      observações e datas. Romaneios que já estavam "fechado" ganham
--      um `codigo_barras` novo (CXxxxxxx), no mesmo formato das
--      caixas normais — o `codigo` antigo (PROD-00001, ...) NÃO é
--      preservado, porque a numeração agora é a sequência única de
--      `caixas` (mesma regra que já vale pra Almoxarifado/Expedição).
--   3. Reaponta a fila de desenho técnico (`desenho_tecnico_impressao_fila`)
--      para os NOVOS itens em `caixa_itens`, renomeando a coluna de
--      `romaneio_item_id` para `caixa_item_id`.
--
-- IMPORTANTE — leia antes de rodar:
--   - Rode isto UMA ÚNICA VEZ. Rodar de novo duplicaria as caixas
--     migradas (não há proteção automática contra isso).
--   - Faça um backup do banco antes (mysqldump) — é uma migração de
--     dados de verdade, não só de estrutura.
--   - As tabelas antigas (romaneios_producao, romaneio_producao_itens,
--     romaneio_producao_impressao_fila) e a view
--     v_romaneios_producao_resumo NÃO são apagadas por este script —
--     ficam como histórico/backup. O bloco OPCIONAL no final remove
--     tudo isso; só rode depois de conferir no app que as caixas
--     migradas aparecem certinho (histórico, itens, romaneio em PDF).
--   - Se o servidor não tiver nenhum romaneio de Produção ainda
--     (banco novo, ou perfil nunca usado), os passos 2 e 3 simplesmente
--     não migram nada — não há problema em rodar mesmo assim.
-- ============================================================

-- 1) ENUMs -------------------------------------------------------
ALTER TABLE caixas
  MODIFY criado_por_perfil ENUM('expedicao', 'em_campo', 'almoxarifado', 'producao') NOT NULL DEFAULT 'almoxarifado';

ALTER TABLE etiqueta_fila
  MODIFY solicitado_por_perfil ENUM('almoxarifado', 'expedicao', 'producao') NOT NULL;

-- 2) Migração dos dados -------------------------------------------
-- Tabelas de apoio (mapeiam id antigo -> id novo) — ficam no banco
-- depois do script rodar, pra você conferir a correspondência caso
-- precise. Removidas só no bloco opcional do final.
DROP TABLE IF EXISTS migracao_producao_map_romaneio;
DROP TABLE IF EXISTS migracao_producao_map_item;

CREATE TABLE migracao_producao_map_romaneio (
  romaneio_id_antigo INT UNSIGNED NOT NULL PRIMARY KEY,
  caixa_id_novo       INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE migracao_producao_map_item (
  item_id_antigo INT UNSIGNED NOT NULL PRIMARY KEY,
  item_id_novo   INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS _migrar_producao_para_caixas;

DELIMITER $$
CREATE PROCEDURE _migrar_producao_para_caixas()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_id INT UNSIGNED;
  DECLARE v_status ENUM('aberto','fechado');
  DECLARE v_responsavel VARCHAR(150);
  DECLARE v_projeto VARCHAR(50);
  DECLARE v_obs VARCHAR(500);
  DECLARE v_criado DATETIME;
  DECLARE v_fechado DATETIME;
  DECLARE novo_caixa_id INT UNSIGNED;

  DECLARE cur_romaneios CURSOR FOR
    SELECT id, status, responsavel_nome, numero_projeto, observacoes, criado_em, fechado_em
    FROM romaneios_producao ORDER BY id ASC;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  -- 2a) romaneios_producao -> caixas ------------------------------
  OPEN cur_romaneios;
  loop_romaneios: LOOP
    FETCH cur_romaneios INTO v_id, v_status, v_responsavel, v_projeto, v_obs, v_criado, v_fechado;
    IF done THEN LEAVE loop_romaneios; END IF;

    INSERT INTO caixas (status, responsavel_nome, numero_projeto, observacoes, criado_por_perfil, criado_em, fechado_em)
    VALUES (
      IF(v_status = 'fechado', 'fechada', 'aberta'),
      v_responsavel, v_projeto, v_obs, 'producao', v_criado, v_fechado
    );
    SET novo_caixa_id = LAST_INSERT_ID();

    IF v_status = 'fechado' THEN
      UPDATE caixas SET codigo_barras = CONCAT('CX', LPAD(novo_caixa_id, 6, '0')) WHERE id = novo_caixa_id;
    END IF;

    INSERT INTO migracao_producao_map_romaneio (romaneio_id_antigo, caixa_id_novo) VALUES (v_id, novo_caixa_id);
  END LOOP;
  CLOSE cur_romaneios;

  -- 2b) romaneio_producao_itens -> caixa_itens ---------------------
  SET done = 0;
  BEGIN
    DECLARE v_item_id INT UNSIGNED;
    DECLARE v_romaneio_id INT UNSIGNED;
    DECLARE v_codigo_item VARCHAR(100);
    DECLARE v_descricao VARCHAR(255);
    DECLARE v_quantidade DECIMAL(10,2);
    DECLARE v_item_responsavel VARCHAR(150);
    DECLARE v_ordem SMALLINT UNSIGNED;
    DECLARE v_item_criado DATETIME;
    DECLARE novo_item_id INT UNSIGNED;
    DECLARE caixa_correspondente INT UNSIGNED;

    DECLARE cur_itens CURSOR FOR
      SELECT id, romaneio_id, codigo_item, descricao, quantidade, responsavel_nome, ordem, criado_em
      FROM romaneio_producao_itens ORDER BY id ASC;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

    OPEN cur_itens;
    loop_itens: LOOP
      FETCH cur_itens INTO v_item_id, v_romaneio_id, v_codigo_item, v_descricao, v_quantidade, v_item_responsavel, v_ordem, v_item_criado;
      IF done THEN LEAVE loop_itens; END IF;

      SELECT caixa_id_novo INTO caixa_correspondente
        FROM migracao_producao_map_romaneio WHERE romaneio_id_antigo = v_romaneio_id;

      INSERT INTO caixa_itens (caixa_id, codigo_item, descricao, quantidade, responsavel_nome, ordem, criado_em)
      VALUES (caixa_correspondente, v_codigo_item, v_descricao, v_quantidade, v_item_responsavel, v_ordem, v_item_criado);
      SET novo_item_id = LAST_INSERT_ID();

      INSERT INTO migracao_producao_map_item (item_id_antigo, item_id_novo) VALUES (v_item_id, novo_item_id);
    END LOOP;
    CLOSE cur_itens;
  END;
END$$
DELIMITER ;

CALL _migrar_producao_para_caixas();
DROP PROCEDURE _migrar_producao_para_caixas;

-- 3) Reaponta a fila de desenho técnico para os novos itens --------
-- (roda mesmo se a fila estiver vazia ou se não havia nada pra
-- migrar acima — os JOINs/UPDATEs simplesmente não afetam nada).
ALTER TABLE desenho_tecnico_impressao_fila
  DROP FOREIGN KEY fk_desenho_tecnico_impressao_fila_item;

UPDATE desenho_tecnico_impressao_fila d
JOIN migracao_producao_map_item m ON m.item_id_antigo = d.romaneio_item_id
SET d.romaneio_item_id = m.item_id_novo;

ALTER TABLE desenho_tecnico_impressao_fila
  CHANGE romaneio_item_id caixa_item_id INT UNSIGNED NOT NULL;

ALTER TABLE desenho_tecnico_impressao_fila
  ADD CONSTRAINT fk_desenho_tecnico_impressao_fila_item
  FOREIGN KEY (caixa_item_id) REFERENCES caixa_itens(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- 4) Conferência ----------------------------------------------------
-- Compare os dois números de cada linha — devem ser iguais.
SELECT
  (SELECT COUNT(*) FROM romaneios_producao)          AS total_romaneios_antigos,
  (SELECT COUNT(*) FROM migracao_producao_map_romaneio) AS total_caixas_migradas;

SELECT
  (SELECT COUNT(*) FROM romaneio_producao_itens)     AS total_itens_antigos,
  (SELECT COUNT(*) FROM migracao_producao_map_item)  AS total_itens_migrados;

-- ============================================================
-- OPCIONAL — só descomente e rode DEPOIS de conferir no app que as
-- caixas migradas aparecem certinho (histórico, itens, romaneio em
-- PDF). Isso é IRREVERSÍVEL: apaga as tabelas antigas de vez.
-- ============================================================
-- DROP TABLE migracao_producao_map_item;
-- DROP TABLE migracao_producao_map_romaneio;
-- DROP TABLE romaneio_producao_impressao_fila;
-- DROP TABLE romaneio_producao_itens;
-- DROP TABLE romaneios_producao;
-- DROP VIEW IF EXISTS v_romaneios_producao_resumo;
