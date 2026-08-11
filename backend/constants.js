// Lista fixa dos responsáveis do Almoxarifado autorizados a montar,
// alterar e finalizar caixas. Usada para validar o campo
// "responsavel_nome" em backend/routes/caixas.js.
//
// O mesmo conjunto de nomes é replicado no <select> do frontend
// (frontend/index.html) — se a lista mudar aqui, atualize lá também.
const ALMOXARIFADO_RESPONSAVEIS = ['Kerllon Pereira', 'Léo Neves', 'Filipe Luchtenberg'];

module.exports = { ALMOXARIFADO_RESPONSAVEIS };
