// Listas fixas dos responsáveis autorizados a montar, alterar e
// finalizar caixas/romaneios, por perfil.
//
// O mesmo conjunto de nomes é replicado no frontend
// (RESPONSAVEIS_POR_PERFIL em frontend/index.html) — se uma lista
// mudar aqui, atualize lá também.
const ALMOXARIFADO_RESPONSAVEIS = ['Kerllon Pereira', 'Léo Neves', 'Filipe Luchtenberg', 'Diter Doering'];
// Produção usa as MESMAS tabelas de Almoxarifado/Expedição (caixas/
// caixa_itens — ver backend/routes/caixas.js), só com uma equipe
// própria diferente.
const PRODUCAO_RESPONSAVEIS = ['Diego Alves', 'Claudemir Miranda', 'Jânio Bauer'];

// Usado por backend/routes/caixas.js — Expedição monta caixa com a
// mesma equipe física do Almoxarifado (mesma lista); Produção tem a
// sua própria.
const RESPONSAVEIS_POR_PERFIL = {
  almoxarifado: ALMOXARIFADO_RESPONSAVEIS,
  expedicao:    ALMOXARIFADO_RESPONSAVEIS,
  producao:     PRODUCAO_RESPONSAVEIS,
};

module.exports = { ALMOXARIFADO_RESPONSAVEIS, PRODUCAO_RESPONSAVEIS, RESPONSAVEIS_POR_PERFIL };
