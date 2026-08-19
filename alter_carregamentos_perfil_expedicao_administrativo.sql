-- ============================================================
-- Central Expedição — Migração
-- Adiciona o valor 'expedicao_administrativo' ao ENUM
-- carregamentos.criado_por_perfil, para o novo perfil "Expedição
-- Administrativo" (mesmas telas de Expedição + Em Campo, com
-- permissão extra de digitar código de item manualmente e marcar
-- itens do desembarque manualmente).
--
-- Rode este script em bancos já provisionados. Instalações novas já
-- recebem o ENUM atualizado direto de banco_de_dados.sql.
-- ============================================================

USE burntech_expedicao;

ALTER TABLE carregamentos
  MODIFY COLUMN criado_por_perfil
    ENUM('expedicao', 'em_campo', 'almoxarifado', 'expedicao_administrativo')
    NOT NULL DEFAULT 'expedicao';
