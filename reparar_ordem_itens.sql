-- ============================================================
-- Central Expedição — Script de reparo (rodar uma única vez)
-- Corrige valores de "ordem" corrompidos em caixa_itens e
-- carregamento_itens, causados por um bug no backend: a consulta
-- SELECT COALESCE(MAX(ordem), 0) volta do driver mysql2 como texto
-- (não número), então "maxOrdem + i + 1" virava concatenação de
-- string em vez de soma (ex.: "101" + 0 + 1 = "1011"). A cada rodada
-- de "Alterar" o valor inflava (1 -> 101 -> 10101 -> 10111 -> ...)
-- até estourar o limite da coluna (SMALLINT UNSIGNED, máx. 65535),
-- bloqueando novas alterações na caixa/carregamento com o erro
-- "Out of range value for column 'ordem'".
--
-- O bug já foi corrigido no código (routes/caixas.js e
-- routes/carregamentos.js). Este script só limpa os dados que já
-- ficaram com "ordem" corrompido, renumerando 1, 2, 3... dentro de
-- cada caixa/carregamento, mantendo a ordem relativa atual (que
-- continua correta mesmo com os números inflados, já que cada
-- rodada gerou valores maiores que a anterior).
--
-- Seguro rodar mesmo que nada esteja corrompido — só renumera
-- sequencialmente, sem mudar a ordem de exibição dos itens.
-- ============================================================

USE burntech_expedicao;

UPDATE caixa_itens ci
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY caixa_id ORDER BY ordem ASC, id ASC) AS novo_ordem
  FROM caixa_itens
) t ON t.id = ci.id
SET ci.ordem = t.novo_ordem;

UPDATE carregamento_itens ci
JOIN (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY carregamento_id ORDER BY ordem ASC, id ASC) AS novo_ordem
  FROM carregamento_itens
) t ON t.id = ci.id
SET ci.ordem = t.novo_ordem;
