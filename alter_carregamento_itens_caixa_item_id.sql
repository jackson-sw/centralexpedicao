-- ============================================================
-- Central Expedição — Rastrear o responsável exato por item
--
-- Até agora, ao ler o código de barras de uma caixa dentro de um
-- carregamento, cada item herdava só o vínculo com a caixa
-- (caixa_id) — não com o registro específico em caixa_itens que
-- guarda QUEM colocou aquele item na caixa. No romaneio, isso fazia
-- o PDF mostrar sempre o responsável pelo carregamento em vez do
-- responsável real por cada item (o funcionário do almoxarifado que
-- montou a caixa).
--
-- Este script adiciona caixa_item_id em carregamento_itens, ligando
-- cada item do carregamento ao item exato da caixa de origem.
-- Seguro rodar mesmo com dados existentes (coluna NULL para
-- carregamentos antigos e itens avulsos).
-- ============================================================

USE burntech_expedicao;

ALTER TABLE carregamento_itens
  ADD COLUMN caixa_item_id INT UNSIGNED NULL AFTER caixa_id,
  ADD KEY idx_itens_caixa_item_id (caixa_item_id),
  ADD CONSTRAINT fk_itens_caixa_item
    FOREIGN KEY (caixa_item_id) REFERENCES caixa_itens(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
