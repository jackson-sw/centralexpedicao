-- ============================================================
-- Central Expedição — Migração
-- Torna o campo "numero_projeto" da tabela caixas OBRIGATÓRIO
-- (NOT NULL). O backend (POST /api/caixas) e a tela de Nova Caixa
-- já exigem o número do projeto; este script alinha o banco.
--
-- Rode este script em bancos já provisionados. Instalações novas
-- já recebem a coluna como NOT NULL direto de banco_de_dados.sql.
--
-- ATENÇÃO: caixas antigas podem ter numero_projeto NULL ou vazio (o
-- campo era opcional). Com o MySQL em modo estrito (padrão), o ALTER
-- abaixo FALHA sem alterar nada se existir alguma linha NULL — então
-- é seguro rodar, mas antes confira/corrija essas caixas (passo 1).
-- ============================================================

USE burntech_expedicao;

-- 1) Caixas sem projeto — corrija cada uma antes do passo 2, informando
--    o projeto certo, por exemplo:
--      UPDATE caixas SET numero_projeto = '250492' WHERE id = 123;
SELECT id, codigo_barras, status, responsavel_nome, criado_em
FROM caixas
WHERE numero_projeto IS NULL OR TRIM(numero_projeto) = '';

-- 2) Só depois de o SELECT acima não retornar nenhuma linha:
ALTER TABLE caixas
  MODIFY COLUMN numero_projeto VARCHAR(50) NOT NULL;
