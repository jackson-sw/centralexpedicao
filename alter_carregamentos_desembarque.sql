-- ============================================================
-- Central Expedição — Perfil Em Campo: fluxo de Desembarque
--
-- Uma pessoa do perfil Em Campo confere, item a item (por leitura de
-- código de barras ou toque manual), os materiais que chegaram no
-- destino de um carregamento. Ao salvar, se algum item não foi
-- conferido, o carregamento fica marcado como desembarque "parcial"
-- em vez de "concluido" — mas o salvamento é permitido mesmo assim.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE carregamentos
  ADD COLUMN desembarque_status ENUM('pendente', 'parcial', 'concluido') NOT NULL DEFAULT 'pendente' AFTER criado_por_perfil,
  ADD COLUMN desembarque_responsavel VARCHAR(150) NULL AFTER desembarque_status,
  ADD COLUMN desembarque_em DATETIME NULL AFTER desembarque_responsavel,
  ADD KEY idx_carregamentos_desembarque_status (desembarque_status);

ALTER TABLE carregamento_itens
  ADD COLUMN desembarcado_em DATETIME NULL AFTER ordem;

-- Recria a view já incluindo as novas colunas (mesmo cuidado de sempre:
-- v_carregamentos_resumo usa lista explícita de colunas, então qualquer
-- coluna nova em "carregamentos" precisa ser adicionada aqui também).
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
