// Listas fixas dos responsáveis autorizados a montar, alterar e
// finalizar caixas/romaneios, por perfil.
//
// O mesmo conjunto de nomes é replicado no frontend
// (RESPONSAVEIS_POR_PERFIL em frontend/index.html) — se uma lista
// mudar aqui, atualize lá também.
const ALMOXARIFADO_RESPONSAVEIS = ['Kerllon Pereira', 'Léo Neves', 'Filipe Luchtenberg', 'Diter Doering'];
// Produção tem gente própria e tabelas próprias (romaneios_producao /
// romaneio_producao_itens — ver backend/routes/romaneiosProducao.js),
// não usa caixas/caixa_itens nem RESPONSAVEIS_POR_PERFIL abaixo.
const PRODUCAO_RESPONSAVEIS = ['Diego Alves', 'Claudemir Miranda', 'Jânio Bauer'];

// Usado só por backend/routes/caixas.js — Expedição monta caixa com a
// mesma equipe física do Almoxarifado (mesma lista).
const RESPONSAVEIS_POR_PERFIL = {
  almoxarifado: ALMOXARIFADO_RESPONSAVEIS,
  expedicao:    ALMOXARIFADO_RESPONSAVEIS,
};

module.exports = { ALMOXARIFADO_RESPONSAVEIS, PRODUCAO_RESPONSAVEIS, RESPONSAVEIS_POR_PERFIL };
