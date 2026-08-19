# Central Expedição — Burntech Caldeiras

Sistema de controle de carregamento e descarregamento do setor de expedição da Burntech Caldeiras (Agrolândia, SC). Segue o mesmo padrão de arquitetura do sistema irmão **Central Logística**: backend Express + MySQL, frontend em um único arquivo HTML (sem build), PWA instalável no celular.

## Arquitetura

- `backend/` — API REST em Express (Node.js, CommonJS, `mysql2/promise`). Ponto de entrada: `backend/server.js`. Usa `pdfkit` para gerar o romaneio em PDF de cada caixa e `nodemailer` (`backend/mail.js`) para enviá-lo por e-mail. `backend/dbErp.js` mantém uma segunda conexão, somente leitura, com o banco do ERP (SQL Server) — ver [Catálogo de itens (ERP)](#catálogo-de-itens-erp).
- `frontend/index.html` — frontend inteiro em um único arquivo (CSS e JS inline, sem framework, sem bundler). Usa a biblioteca `html5-qrcode` (via CDN) para leitura de código de barras pela câmera e `JsBarcode` (via CDN) para gerar o código de barras da caixa.
- `frontend/admin.html` — painel administrativo separado (rota `/admin`), com login próprio, para consultar o catálogo de itens/materiais (somente leitura — vem do ERP).
- `frontend/manifest.json` + `frontend/service-worker.js` — configuração PWA (instalável, com cache do app shell).
- `banco_de_dados.sql` — DDL completo do MySQL (tabelas + view), executado uma vez para provisionar o banco.
- `Dockerfile` + `docker-compose.yml` — build da imagem (backend + frontend) e orquestração com MySQL, para deploy em VPS.

O backend serve o frontend estaticamente — em produção tudo roda em um único processo Node em uma única porta.

## Autenticação

Perfis fixos, sem tabela de usuários — senha validada por hash bcrypt guardado em `backend/.env` (mesmo modelo usado pelo perfil "Central Profissional" do Central Logística):

- **Expedição** (senha padrão: `exp!2027`) — vê o histórico de carregamentos (e, somente leitura, o de caixas) e pode registrar novos carregamentos.
- **Almoxarifado** (senha padrão: `Almox0987`) — monta, altera e finaliza as caixas (ver [Fluxo de caixas](#fluxo-de-caixas) abaixo): move os itens pequenos do almoxarifado para o pátio da expedição.
- **Em Campo** (senha padrão: `emcampo!26`) — confere o desembarque dos carregamentos no destino (ver [Fluxo de desembarque](#fluxo-de-desembarque) abaixo).

Para trocar as senhas, gere um novo hash e atualize `EXPEDICAO_PASSWORD_HASH` / `EM_CAMPO_PASSWORD_HASH` / `ALMOXARIFADO_PASSWORD_HASH` em `backend/.env`:

```bash
node -e "require('bcrypt').hash('SUA_SENHA',12).then(h=>console.log(h))"
```

Existe ainda um terceiro perfil, **Admin** (senha padrão: `admin!2027`), exclusivo do painel administrativo em `/admin` — não aparece na tela de login do app, tem sua própria página e usa `ADMIN_PASSWORD_HASH` no `.env`. Diferente dos perfis Expedição/Em Campo, o token do admin não fica salvo no navegador (`localStorage`) — é preciso logar a cada acesso ao painel, por segurança.

## Fluxo de caixas

Uma caixa passa por três estados: **aberta → fechada → expedida**.

1. **Salvar** (perfil Almoxarifado) — abre uma caixa nova com o primeiro lote de itens e, opcionalmente, o número do projeto ao qual ela pertence. Ela nasce **aberta** e ainda não tem código de barras.
2. **Alterar** — enquanto a caixa estiver aberta, qualquer responsável do Almoxarifado pode adicionar mais itens. Cada rodada de "Alterar" exige selecionar quem está adicionando os itens naquele momento — o sistema guarda o responsável de cada item individualmente, então uma caixa pode ter itens de vários responsáveis diferentes.
3. **Finalizar** — fecha a caixa: grava a data/hora de fechamento e gera o código de barras (`CXxxxxxx`), pronto para etiqueta. A partir daqui a caixa não aceita mais itens. A etiqueta impressa (100mm × 70mm) traz o número do projeto (quando informado) e a data/hora de fechamento, além do código de barras.
4. **Romaneio** — disponível depois de finalizada. Gera um PDF com todos os itens, todos os responsáveis envolvidos e a data/hora de fechamento, baixa o arquivo automaticamente e envia uma cópia por e-mail para o(s) destinatário(s) configurado(s) em `ROMANEIO_EMAIL_TO`.
5. **Expedida** — quando o código de barras da caixa é lido durante um "Novo Carregamento" (perfil Expedição), o status muda automaticamente para expedida.

Os responsáveis do Almoxarifado são uma lista fixa (definida em `backend/constants.js` e replicada no `<select>` do frontend): **Kerllon Pereira**, **Léo Neves** e **Filipe Luchtenberg**.

## Fluxo de desembarque

O perfil **Em Campo** lista todos os carregamentos (com busca por número de projeto no topo da tela) e confere, no destino, se os itens que saíram realmente chegaram.

1. **Desembarque** — abre a tela de conferência de um carregamento: nome do responsável pelo desembarque, barra de progresso e a lista de itens daquele carregamento (cada linha é um item avulso ou uma caixa inteira, do jeito que foi carregada).
2. **Conferência** — cada item pode ser confirmado de três formas: lendo o código de barras pela câmera (fecha e mostra a confirmação a cada leitura — escaneia de novo pra conferir o próximo item, evitando dúvida sobre se a leitura realmente registrou), digitando o código no campo manual + Enter, ou tocando direto na linha do item (útil quando o código está ilegível). Tocar de novo desfaz a conferência.
3. **Salvar** — fecha a tela de desembarque e grava o responsável e a data/hora. Se algum item não foi conferido, o sistema avisa quantos estão faltando mas **permite salvar mesmo assim** — o carregamento fica com status `parcial` em vez de `concluido`. É possível reabrir o desembarque depois e continuar de onde parou (nada é perdido ao fechar sem salvar).
4. **Romaneio de Faltantes** — gera um PDF só com os itens ainda não conferidos (ou uma confirmação de que está tudo certo, se não faltar nada) e envia por e-mail para o(s) destinatário(s) em `ROMANEIO_EMAIL_TO` — disponível a qualquer momento durante a conferência, não precisa ter clicado Salvar antes.

Cada card na lista do perfil Em Campo mostra o status do desembarque: **Pendente** (ninguém salvou ainda), **Parcial** (salvo, mas faltou item) ou **Concluído** (salvo com tudo conferido).

## Painel Administrativo (`/admin`)

Consulta do catálogo de itens/materiais (código, descrição, quantidade), com busca, ordenação e paginação — **somente leitura**. Cadastro, edição e exclusão de itens não acontecem mais aqui: são feitos direto no ERP (ver seção abaixo). Acesse em `http://localhost:3002/admin` (ou `https://seu-dominio.com.br/admin` em produção) e entre com a senha do Admin.

## Catálogo de itens (ERP)

O catálogo de itens/materiais não é mais mantido dentro desta aplicação. Toda consulta de item — auto-preenchimento de descrição em Novo Carregamento/Nova Caixa/Alterar Caixa e a listagem do painel admin — é feita **em tempo real** direto no banco do ERP (SQL Server), na tabela `PRO_PRODUTO`:

| Campo do sistema | Coluna no ERP (`PRO_PRODUTO`) |
|---|---|
| código | `PRO_Codigo` |
| descrição | `PRO_Descricao` |
| quantidade | `PRO_PesoLiquido` |

`backend/dbErp.js` mantém uma pool de conexões própria (via `mssql`/Tedious) separada da conexão MySQL principal — essa conexão é somente leitura, a aplicação nunca grava no ERP. As credenciais ficam em `backend/.env` (`ERP_DB_*`, ver abaixo).

Para diagnosticar problemas de conexão sem precisar logar no app:

```bash
curl http://localhost:3002/api/health/erp
```

A tabela `itens_materiais` que existia no MySQL local não é mais usada pelo sistema — instalações antigas podem removê-la com `alter_remover_itens_materiais.sql` (opcional, ver [Atualizando um banco já existente](#atualizando-um-banco-já-existente)).

## Setup e execução

```bash
# 1. Banco de dados (MySQL 8+)
mysql -u root -p < banco_de_dados.sql

# 2. Backend
cd backend
cp .env.example .env   # configure DB_*, JWT_SECRET, CORS_ORIGIN, SMTP
npm install
npm start               # produção
npm run dev             # nodemon, com reload automático
```

O servidor roda em `http://localhost:3002` por padrão (variável `PORT`) e ele mesmo serve o frontend.

## Deploy com Docker

O projeto inclui `Dockerfile` e `docker-compose.yml` (app + MySQL) — é a forma recomendada de publicar em uma VPS.

### 1. Pré-requisitos na VPS

```bash
# Ubuntu/Debian — instala Docker Engine + plugin do Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # relogue após este comando
```

### 2. Clonar e configurar

```bash
git clone https://github.com/SEU_USUARIO/central-expedicao.git
cd central-expedicao
cp .env.example .env
# edite o .env com DB_PASSWORD, DB_ROOT_PASSWORD, JWT_SECRET,
# EXPEDICAO_PASSWORD_HASH, EM_CAMPO_PASSWORD_HASH, credenciais SMTP etc.
```

### 3. Subir os containers

```bash
docker compose up -d --build
```

Isso cria dois containers:
- **db** (MySQL 8) — já inicializa o schema a partir de `banco_de_dados.sql` na primeira execução (volume vazio).
- **app** (Node/Express) — exposto na porta definida em `PORT` (padrão `3002`), aguarda o banco ficar saudável antes de iniciar.

Para gerar um novo hash de senha (Expedição ou Em Campo) dentro do próprio container:

```bash
docker compose exec app node -e "require('bcrypt').hash('SUA_SENHA',12).then(console.log)"
# copie o hash gerado para EXPEDICAO_PASSWORD_HASH, EM_CAMPO_PASSWORD_HASH ou ALMOXARIFADO_PASSWORD_HASH no .env
# e rode: docker compose up -d --build
```

### 4. Domínio + HTTPS

A aplicação fica disponível em `http://IP_DA_VPS:3002`. Para expor em `https://seu-dominio.com.br`, configure um proxy reverso (Nginx é o mais comum) apontando para `localhost:3002`, e gere um certificado gratuito com **Certbot** (Let's Encrypt). HTTPS é obrigatório em produção para o navegador liberar o acesso à câmera (leitor de código de barras).

### Comandos úteis

```bash
docker compose logs -f app      # acompanhar logs da aplicação
docker compose ps               # status dos containers
docker compose down             # parar (mantém os dados do volume db_data)
docker compose up -d --build    # rebuildar após alterações no código
```

## PWA (instalação no celular)

Acesse a URL do sistema pelo navegador do celular (Chrome/Safari) e use "Adicionar à tela inicial" / "Instalar app". O `manifest.json` e o `service-worker.js` já deixam o app instalável e com o app shell em cache para carregamento rápido. Chamadas de API sempre buscam dados atualizados da rede (não ficam em cache offline).

## Leitor de código de barras

O botão 📷 ao lado do campo "Código do item" abre a câmera do dispositivo (via `html5-qrcode`) e decodifica automaticamente os formatos mais comuns de código de barras (CODE128, CODE39, EAN-13/8, UPC-A/E) além de QR Code. Requer HTTPS em produção para o navegador liberar o acesso à câmera (exceto em `localhost`).

## Atualização em tempo real

A tela de histórico do perfil Expedição atualiza automaticamente a cada 25 segundos via polling (mesma abordagem usada no Central Logística), sem necessidade de infraestrutura de WebSocket.

## Variáveis de ambiente necessárias (`backend/.env`)

`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `EXPEDICAO_PASSWORD_HASH`, `EM_CAMPO_PASSWORD_HASH`, `ALMOXARIFADO_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_DEFAULT_SENDER`, `ROMANEIO_EMAIL_TO`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASSWORD`, `ERP_DB_ENCRYPT` — ver `backend/.env.example`.

As configurações SMTP em `backend/mail.js` são usadas para enviar automaticamente o romaneio (PDF) ao finalizar uma caixa — ver [Fluxo de caixas](#fluxo-de-caixas). As configurações `ERP_DB_*` conectam ao banco do ERP para o catálogo de itens — ver [Catálogo de itens (ERP)](#catálogo-de-itens-erp).

## Atualizando um banco já existente

Se o banco já foi provisionado com uma versão anterior do `banco_de_dados.sql`, rode manualmente os scripts incrementais que ainda não foram aplicados, na ordem:

```bash
mysql -u root -p burntech_expedicao < alter_almoxarifado.sql            # perfil Almoxarifado
mysql -u root -p burntech_expedicao < alter_itens_materiais_quantidade.sql  # campo Quantidade no catálogo (legado, ver abaixo)
mysql -u root -p burntech_expedicao < alter_caixas_workflow.sql         # fluxo aberta/fechada + responsável por item
mysql -u root -p burntech_expedicao < alter_carregamentos_placa.sql     # campo Placa no carregamento
mysql -u root -p burntech_expedicao < alter_view_carregamentos_placa.sql          # corrige view sem a coluna placa
mysql -u root -p burntech_expedicao < alter_carregamento_itens_caixa_item_id.sql  # rastreia responsável por item no romaneio
mysql -u root -p burntech_expedicao < alter_remover_itens_materiais.sql # opcional — remove a tabela local, não usada desde a integração com o ERP
mysql -u root -p burntech_expedicao < alter_carregamentos_desembarque.sql # fluxo de Desembarque (perfil Em Campo)
mysql -u root -p burntech_expedicao < alter_caixas_numero_projeto.sql   # campo numero_projeto na etiqueta da caixa
```

## Próximos passos (fora do escopo desta primeira versão)

- Tela dedicada de "Novo Descarregamento" (a coluna `tipo` já existe no banco, pronta para isso).
- Envio de e-mail de notificação ao registrar um carregamento.
