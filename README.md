# Central Expedição — Burntech Caldeiras

Sistema de controle de carregamento e descarregamento do setor de expedição da Burntech Caldeiras (Agrolândia, SC). Segue o mesmo padrão de arquitetura do sistema irmão **Central Logística**: backend Express + MySQL, frontend em um único arquivo HTML (sem build), PWA instalável no celular.

## Arquitetura

- `backend/` — API REST em Express (Node.js, CommonJS, `mysql2/promise`). Ponto de entrada: `backend/server.js`.
- `frontend/index.html` — frontend inteiro em um único arquivo (CSS e JS inline, sem framework, sem bundler). Usa a biblioteca `html5-qrcode` (via CDN) para leitura de código de barras pela câmera e `JsBarcode` (via CDN) para gerar o código de barras da caixa.
- `frontend/admin.html` — painel administrativo separado (rota `/admin`), com login próprio, para cadastro de itens/materiais (código + descrição).
- `frontend/manifest.json` + `frontend/service-worker.js` — configuração PWA (instalável, com cache do app shell).
- `banco_de_dados.sql` — DDL completo do MySQL (tabelas + view), executado uma vez para provisionar o banco.
- `Dockerfile` + `docker-compose.yml` — build da imagem (backend + frontend) e orquestração com MySQL, para deploy em VPS.

O backend serve o frontend estaticamente — em produção tudo roda em um único processo Node em uma única porta.

## Autenticação

Dois perfis fixos, sem tabela de usuários — senha validada por hash bcrypt guardado em `backend/.env` (mesmo modelo usado pelo perfil "Central Profissional" do Central Logística):

- **Expedição** (senha padrão: `exp!2027`) — acesso completo: vê o histórico e pode registrar novos carregamentos.
- **Em Campo** (senha padrão: `emcampo!26`) — login funcional, mas por enquanto exibe uma tela "em breve" (funcionalidade ainda não definida).

Para trocar as senhas, gere um novo hash e atualize `EXPEDICAO_PASSWORD_HASH` / `EM_CAMPO_PASSWORD_HASH` em `backend/.env`:

```bash
node -e "require('bcrypt').hash('SUA_SENHA',12).then(h=>console.log(h))"
```

Existe ainda um terceiro perfil, **Admin** (senha padrão: `admin!2027`), exclusivo do painel administrativo em `/admin` — não aparece na tela de login do app, tem sua própria página e usa `ADMIN_PASSWORD_HASH` no `.env`. Diferente dos perfis Expedição/Em Campo, o token do admin não fica salvo no navegador (`localStorage`) — é preciso logar a cada acesso ao painel, por segurança.

## Painel Administrativo (`/admin`)

Cadastro do catálogo de itens/materiais (campos: **código** e **descrição**), com busca, ordenação, paginação e edição/exclusão — acesse em `http://localhost:3002/admin` (ou `https://seu-dominio.com.br/admin` em produção) e entre com a senha do Admin.

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
# copie o hash gerado para EXPEDICAO_PASSWORD_HASH ou EM_CAMPO_PASSWORD_HASH no .env
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

`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `EXPEDICAO_PASSWORD_HASH`, `EM_CAMPO_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_DEFAULT_SENDER` — ver `backend/.env.example`.

As configurações SMTP já estão prontas em `backend/mail.js` (transporter configurado), mas nenhuma rota dispara e-mail automaticamente ainda — fica pronto para quando uma notificação (ex.: novo carregamento registrado) for solicitada.

## Próximos passos (fora do escopo desta primeira versão)

- Definir e implementar as funcionalidades do perfil "Em Campo".
- Tela dedicada de "Novo Descarregamento" (a coluna `tipo` já existe no banco, pronta para isso).
- Envio de e-mail de notificação ao registrar um carregamento.
