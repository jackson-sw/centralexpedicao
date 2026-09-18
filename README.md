# Central Expedição — Burntech Caldeiras

Sistema de controle de carregamento e descarregamento do setor de expedição da Burntech Caldeiras (Agrolândia, SC). Segue o mesmo padrão de arquitetura do sistema irmão **Central Logística**: backend Express + MySQL, frontend em um único arquivo HTML (sem build), PWA instalável no celular.

## Arquitetura

- `backend/` — API REST em Express (Node.js, CommonJS, `mysql2/promise`). Ponto de entrada: `backend/server.js`. Usa `pdfkit` para gerar o romaneio em PDF de cada caixa e `nodemailer` (`backend/mail.js`) para enviá-lo por e-mail. `backend/dbErp.js` mantém uma segunda conexão, somente leitura, com o banco do ERP (SQL Server) — ver [Catálogo de itens (ERP)](#catálogo-de-itens-erp).
- `frontend/index.html` — frontend inteiro em um único arquivo (CSS e JS inline, sem framework, sem bundler). Usa a biblioteca `html5-qrcode` (via CDN) para leitura de código de barras pela câmera e `JsBarcode` (via CDN) para gerar o código de barras da caixa.
- `frontend/admin.html` — painel administrativo separado (rota `/admin`), com login próprio, para consultar o catálogo de itens/materiais (somente leitura — vem do ERP).
- `frontend/manifest.json` + `frontend/service-worker.js` — configuração PWA (instalável, com cache do app shell).
- `banco_de_dados.sql` — DDL completo do MySQL (tabelas + view), executado uma vez para provisionar o banco.
- `Dockerfile` + `docker-compose.yml` — build da imagem (backend + frontend) e orquestração com MySQL, para deploy em VPS.
- `print-agent/` — script Node independente, roda fora do Docker/VPS, num computador local ligado às impressoras de etiqueta e à laser do romaneio de Produção — ver [Impressão de etiquetas e romaneio de Produção](#impressão-de-etiquetas-e-romaneio-de-produção).
- `desenho-agent/` — script Node independente, roda numa máquina da rede interna com acesso ao servidor de arquivos on-premises, busca e imprime o desenho técnico de itens de estrutura lidos numa caixa do perfil Produção — ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico).

O backend serve o frontend estaticamente — em produção tudo roda em um único processo Node em uma única porta.

## Autenticação

Perfis fixos, sem tabela de usuários — senha validada por hash bcrypt guardado em `backend/.env` (mesmo modelo usado pelo perfil "Central Profissional" do Central Logística):

- **Expedição** (senha padrão: `exp!2027`) — vê o histórico de carregamentos (e, somente leitura, o de caixas) e pode registrar novos carregamentos.
- **Almoxarifado** (senha padrão: `Almox0987`) — monta, altera e finaliza as caixas (ver [Fluxo de caixas](#fluxo-de-caixas) abaixo): move os itens pequenos do almoxarifado para o pátio da expedição.
- **Produção** (senha padrão: `Prod#2026`) — **idêntico** ao Almoxarifado (monta, altera e finaliza caixas nas mesmas tabelas `caixas`/`caixa_itens`, mesma numeração `CXxxxxxx`, mesma etiqueta e impressora Argox), só com sua própria lista de responsáveis (ver [Fluxo de caixas](#fluxo-de-caixas) abaixo). A única diferença é que itens lidos no formato de estrutura de engenharia disparam a busca e impressão automática do desenho técnico correspondente — ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico).
- **Em Campo** (senha padrão: `emcampo!26`) — confere o desembarque dos carregamentos no destino (ver [Fluxo de desembarque](#fluxo-de-desembarque) abaixo).
- **Expedição Administrativo** (senha padrão: `Bioc!@09`) — reúne as telas de Expedição e Em Campo num só login, separadas por uma guia no topo. É o único perfil que permite digitar o código de um item manualmente (em vez de só escanear) e marcar/desmarcar itens do desembarque tocando direto na lista — os demais perfis só confirmam por leitura de código de barras.

Para trocar as senhas, gere um novo hash e atualize `EXPEDICAO_PASSWORD_HASH` / `EM_CAMPO_PASSWORD_HASH` / `ALMOXARIFADO_PASSWORD_HASH` / `PRODUCAO_PASSWORD_HASH` / `EXPEDICAO_ADMINISTRATIVO_PASSWORD_HASH` em `backend/.env`:

```bash
node -e "require('bcrypt').hash('SUA_SENHA',12).then(h=>console.log(h))"
```

Existe ainda um terceiro perfil, **Admin** (senha padrão: `admin!2027`), exclusivo do painel administrativo em `/admin` — não aparece na tela de login do app, tem sua própria página e usa `ADMIN_PASSWORD_HASH` no `.env`. Diferente dos perfis Expedição/Em Campo, o token do admin não fica salvo no navegador (`localStorage`) — é preciso logar a cada acesso ao painel, por segurança.

## Fluxo de carregamento

Cada carregamento é identificado por `numero_projeto` + `sequencial_projeto`, exibido nas telas, PDFs e e-mails de romaneio como **"numero_projeto-sequencial_projeto"** (ex.: `240092-1`, `240092-2`). O `sequencial_projeto` é calculado automaticamente pelo backend a cada "Novo Carregamento" — começa em `1` para o primeiro carregamento daquele número de projeto e incrementa a cada carregamento novo com o mesmo número, permitindo registrar mais de uma carga para o mesmo projeto (ex.: em dias diferentes) sem sobrescrever o controle. O usuário só digita o número do projeto; o sequencial não é um campo do formulário.

Um carregamento passa por dois estados: **em andamento → concluído** (mesmo modelo de aberta/fechada usado pelas caixas):

1. **Salvar Carregamento** (tela "Novo Carregamento", perfil Expedição/Expedição Administrativo) — grava o carregamento com os itens já preenchidos e fecha a janela, mas deixa o status **em andamento**: ainda aceita mais itens depois.
2. **Alterar** — no detalhe de um carregamento em andamento, adiciona mais itens (inclusive lendo o código de uma caixa inteira do Almoxarifado, igual funciona em "Novo Carregamento").
3. **Finalizar** — disponível tanto direto em "Novo Carregamento" (cria já fechado, pulando o passo "em andamento") quanto no detalhe de um carregamento em andamento. Encerra o carregamento: a partir daqui não aceita mais itens, e Romaneio/Desembarque passam a ficar disponíveis.

Enquanto um carregamento está **em andamento**, ele não aparece na lista do perfil Em Campo (nada saiu do pátio ainda) e o Romaneio fica bloqueado — mesma regra de bloqueio que já vale para caixas ainda abertas.

### Confirmação item a item

Em "Novo Carregamento", "Nova Caixa" e nas telas de "Alterar", cada item tem seu próprio botão **"✓ Confirmar"** — ao tocar nele, aquele item é salvo no servidor na hora, em vez de esperar o botão final da tela. O primeiro item confirmado já cria a caixa/carregamento (trancando os campos do cabeçalho, como responsável/projeto/placa/destino, contra edição depois); os itens seguintes só se somam a ela. Editar um item já confirmado marca a linha como pendente de novo — é só confirmar de novo pra reenviar a correção. Isso existe pra não perder itens já lidos se o app fechar sem querer no meio da leitura: só a última linha ainda não confirmada fica em risco, não a lista inteira. Os botões "Salvar"/"Finalizar"/"Fechar" no rodapé confirmam automaticamente qualquer linha pendente antes de encerrar, então nada digitado se perde ao fechar normalmente.

## Fluxo de caixas

Uma caixa passa por três estados: **aberta → fechada → expedida**.

1. **Salvar** (perfis Almoxarifado, Expedição ou Produção) — abre uma caixa nova com o primeiro lote de itens e, opcionalmente, o número do projeto ao qual ela pertence. Ela nasce **aberta** e ainda não tem código de barras.
2. **Alterar** — enquanto a caixa estiver aberta, qualquer responsável de Almoxarifado/Expedição/Produção pode adicionar mais itens (inclusive de outro desses perfis — é uma tabela só, compartilhada pelos três). Cada rodada de "Alterar" exige selecionar quem está adicionando os itens naquele momento — o sistema guarda o responsável de cada item individualmente, então uma caixa pode ter itens de vários responsáveis diferentes.
3. **Finalizar** — fecha a caixa: grava a data/hora de fechamento e gera o código de barras (`CXxxxxxx`), pronto para etiqueta. A partir daqui a caixa não aceita mais itens. A etiqueta (100mm × 70mm) traz o número do projeto (quando informado) e a data/hora de fechamento, além do código de barras — ver [Impressão de etiquetas](#impressão-de-etiquetas) para como ela sai fisicamente na impressora.
4. **Romaneio** — disponível depois de finalizada. Gera um PDF com todos os itens, todos os responsáveis envolvidos e a data/hora de fechamento, baixa o arquivo automaticamente e envia uma cópia por e-mail para o(s) destinatário(s) configurado(s) em `ROMANEIO_CAIXA_EMAIL_TO`.
5. **Expedida** — quando o código de barras da caixa é lido durante um "Novo Carregamento" (perfil Expedição), o status muda automaticamente para expedida.

Os responsáveis são uma lista fixa por perfil (`RESPONSAVEIS_POR_PERFIL`, em `backend/constants.js` e replicada no frontend): Almoxarifado e Expedição compartilham a mesma equipe (`ALMOXARIFADO_RESPONSAVEIS`): **Kerllon Pereira**, **Léo Neves**, **Filipe Luchtenberg** e **Diter Doering**. Produção tem a sua própria (`PRODUCAO_RESPONSAVEIS`): **Diego Alves**, **Claudemir Miranda** e **Jânio Bauer**.

O perfil Produção tem duas diferenças de comportamento em relação a Almoxarifado/Expedição: (a) cada item lido cujo código bate com o padrão de estrutura de engenharia (`NNNNNN-LLLddd`, ex.: `250013-DGA109`) dispara também a busca e impressão automática do desenho técnico correspondente — ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico); e (b) ao gerar o romaneio (botão "🧾 Romaneio") de uma caixa de Produção, além do e-mail, o PDF também é enviado automaticamente para impressão numa impressora a laser (papel A4) e os desenhos técnicos de todos os itens da caixa são reenfileirados para impressão — ver [Impressão de etiquetas e romaneio de Produção](#impressão-de-etiquetas-e-romaneio-de-produção).

## Fluxo de desembarque

O perfil **Em Campo** lista todos os carregamentos (com busca por número de projeto no topo da tela) e confere, no destino, se os itens que saíram realmente chegaram.

1. **Desembarque** — abre a tela de conferência de um carregamento: nome do responsável pelo desembarque, barra de progresso e a lista de itens daquele carregamento (cada linha é um item avulso ou uma caixa inteira, do jeito que foi carregada).
2. **Conferência** — cada item só pode ser confirmado lendo o código de barras pela câmera (fecha e mostra a confirmação a cada leitura — escaneia de novo pra conferir o próximo item, evitando dúvida sobre se a leitura realmente registrou). Não existe digitação manual do código nem toque direto na linha do item — evita que um item seja dado como descarregado sem ter sido realmente escaneado.
3. **Salvar** — fecha a tela de desembarque e grava o responsável e a data/hora. Se algum item não foi conferido, o sistema avisa quantos estão faltando mas **permite salvar mesmo assim** — o carregamento fica com status `parcial` em vez de `concluido`. É possível reabrir o desembarque depois e continuar de onde parou (nada é perdido ao fechar sem salvar).
4. **Romaneio de Faltantes** — gera um PDF só com os itens ainda não conferidos (ou uma confirmação de que está tudo certo, se não faltar nada) e envia por e-mail para o(s) destinatário(s) em `ROMANEIO_CARREGAMENTO_EMAIL_TO` — disponível a qualquer momento durante a conferência, não precisa ter clicado Salvar antes.

Cada card na lista do perfil Em Campo mostra o status do desembarque: **Pendente** (ninguém salvou ainda), **Parcial** (salvo, mas faltou item) ou **Concluído** (salvo com tudo conferido).

## Impressão de etiquetas e romaneio de Produção

As etiquetas de caixa (100mm × 70mm, com código de barras) saem direto nas impressoras térmicas **Argox OS-214 Plus** — uma dedicada ao perfil Almoxarifado (compartilhada com Produção, que usa a mesma impressora/fila), outra ao perfil Expedição. O romaneio das caixas do perfil Produção (PDF A4) também sai automaticamente, numa impressora a laser comum. Nenhum dos dois casos abre diálogo de impressão nem depende do navegador do celular imprimir nada.

Como o backend fica hospedado numa VPS na nuvem e não tem acesso direto às impressoras (que estão na rede local da empresa, ligadas por USB/rede a um computador sempre ligado), a impressão funciona em duas partes, com uma fila para cada caso:

1. **Servidor**:
   - Etiqueta — ao clicar em "🖨️ Imprimir Etiqueta" ou "🖨️ Reimprimir" (visível para Almoxarifado, Expedição e Produção), `POST /api/etiquetas` gera o PDF (`backend/pdf/etiqueta.js`, código de barras via `bwip-js`) e grava na tabela `etiqueta_fila`, associado à impressora daquele perfil (`IMPRESSORA_ALMOXARIFADO_NOME` para Almoxarifado e Produção, `IMPRESSORA_EXPEDICAO_NOME` para Expedição).
   - Romaneio de Produção — ao clicar em "🧾 Romaneio" numa caixa cujo `criado_por_perfil` é `producao`, além de gerar o PDF/e-mail (igual Almoxarifado/Expedição), `POST /api/caixas/:id/romaneio` também grava um pedido na tabela `romaneio_impressao_fila`, associado à impressora configurada em `IMPRESSORA_ROMANEIO_NOME`. Esse mesmo clique ainda reenfileira a busca/impressão do desenho técnico de todos os itens da caixa (ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico)) — o resultado das três coisas (e-mail, impressão do romaneio, desenhos reenfileirados) volta pro app nos cabeçalhos `X-Email-Enviado`/`X-Email-Erro`, `X-Impressao-Enfileirada`/`X-Impressao-Erro` e `X-Desenhos-Enfileirados` da resposta. Para Almoxarifado/Expedição esses dois últimos comportamentos simplesmente não acontecem — só o e-mail.
2. **Agente local** (`print-agent/`) — um script Node, rodando no computador-ponte, consulta as duas filas (`GET /api/etiquetas/pendentes` e `GET /api/romaneio-impressao/pendentes`) a cada poucos segundos, baixa o PDF pronto e manda pra impressora correta usando `pdf-to-printer` (que já embute o SumatraPDF — não precisa instalar nada além do Node). A etiqueta usa `scale: "noscale"` + `orientation: "landscape"` (tamanho exato, sem reajuste); o romaneio não tem opções especiais, deixa o SumatraPDF ajustar ao papel A4 configurado no driver da laser. Depois reporta sucesso/erro de volta pro servidor. Ver `print-agent/README.md` para instalação e configuração para iniciar junto com o Windows.

As rotas de fila (`/api/etiquetas/*` e `/api/romaneio-impressao/*`) não usam o JWT dos perfis — são autenticadas por uma chave fixa (`AGENT_API_KEY`, header `X-Agent-Key`) compartilhada apenas entre o servidor e o agente local, já que ele não é uma pessoa logada no app.

## Impressão automática de desenho técnico

Cada item lido/adicionado numa caixa do perfil Produção cujo código bate com o padrão **`NNNNNN-LLLddd`** (6 dígitos do número do projeto + hífen + 3 letras da estrutura + número da peça — ex.: `250013-DGA109`, onde `DGA` = Dutos de Gases e Ar), opcionalmente seguido de `-posição` (ex.: `250013-DGA109-0463`, ver [Catálogo de itens (ERP)](#catálogo-de-itens-erp)), dispara a busca automática do desenho técnico (PDF) correspondente no servidor de arquivos on-premises, e imprime todas as páginas dele numa impressora a laser — a posição, quando presente, é ignorada aqui (só importa pra consulta de descrição/quantidade no ERP). Itens que não batem com esse padrão (parafuso, material avulso, etc.) são ignorados silenciosamente — não é todo item que tem desenho técnico. Almoxarifado e Expedição nunca disparam essa busca, já que seus itens vêm do catálogo do ERP e não usam esse formato de código.

Este fluxo é **diferente** do de etiqueta/romaneio: o backend não gera nem guarda o PDF do desenho — ele só sabe que existe um pedido de busca. Quem faz o trabalho pesado é um agente novo e independente, o `desenho-agent/`:

1. **Servidor** — sempre que um item é salvo/alterado em `POST /api/caixas` (criar), `POST /api/caixas/:id/itens` (alterar) ou `PUT /api/caixas/:caixaId/itens/:itemId` (editar) por alguém logado como Produção, o `codigo_item` é testado contra o padrão acima; se bater, grava um pedido pendente na tabela `desenho_tecnico_impressao_fila` (projeto + estrutura extraídos do código).
2. **`desenho-agent/`** — script Node independente, rodando numa máquina da rede interna que enxerga o servidor de arquivos (`PASTA_PROJETOS`, ex.: `D:\Engenharia\0 - Engenharia do Produto\02 - Projetos\`) **e também** uma impressora a laser (compartilhada na rede — pode ter um nome diferente nesta máquina, configurado em `IMPRESSORA_DESENHOS_NOME`). A cada poucos segundos ele consulta `GET /api/desenhos-tecnicos/pendentes` e, pra cada pedido:
   - Procura, dentro de `PASTA_PROJETOS`, a subpasta que **começa** com o número do projeto (ex.: `250013-HRS02510T - Frivatti` — o resto do nome não é previsível a partir do código, por isso a busca é por prefixo, não por nome exato).
   - Dentro dela, procura a subpasta que **começa** com as 3 letras da estrutura (ex.: `DGA - Dutos de Gases e Ar`).
   - Dentro dela, procura o `.pdf` cujo nome contenha o projeto e o código completo da estrutura, terminando em `-R<número>.pdf` (ex.: `250013-HRS02510T-DGA109-R00.pdf`); se houver mais de uma revisão, imprime sempre a mais alta.
   - Imprime o PDF encontrado (todas as páginas) direto na impressora, sem passar pelo backend, com `scale: "fit"` + `paperSize: "A4"` (o desenho do CAD quase nunca já vem em A4 — o SumatraPDF encolhe o conteúdo pra caber inteiro na página), e reporta sucesso/erro de volta pra `POST /api/desenhos-tecnicos/:id/concluido` ou `:id/erro`.
3. Se qualquer passo falhar (pasta não encontrada, mais de uma pasta batendo com o prefixo — tratado como erro pra não arriscar imprimir o desenho errado —, arquivo não encontrado), o pedido fica marcado como erro na fila e o agente segue pro próximo; isso nunca trava o salvamento do item nem a caixa.

Ver `desenho-agent/README.md` para instalação e configuração para iniciar junto com o Windows.

### Reimpressão manual dos desenhos

O enfileiramento automático descrito acima só dispara quando o item é criado ou tem o `codigo_item` alterado. Clicar em **"🧾 Romaneio"** numa caixa de Produção já reenfileira a busca/impressão do desenho técnico de todos os itens da caixa (ver [Impressão de etiquetas e romaneio de Produção](#impressão-de-etiquetas-e-romaneio-de-produção)), então normalmente não é preciso fazer mais nada. Ainda assim existe o botão **"📐 Reimprimir Desenhos"**, visível só pro perfil Produção no detalhe da caixa (`frontend/index.html`, `renderFooterCaixaDetalhe`), que chama `POST /api/caixas/:id/reimprimir-desenhos` e faz exatamente a mesma coisa isoladamente — útil pra reenviar só os desenhos sem gerar um novo romaneio, por exemplo se a impressora a laser ficou sem papel na primeira tentativa.

## Painel Administrativo (`/admin`)

Consulta do catálogo de itens/materiais (código, descrição, quantidade), com busca, ordenação e paginação — **somente leitura**. Cadastro, edição e exclusão de itens não acontecem mais aqui: são feitos direto no ERP (ver seção abaixo). Acesse em `http://localhost:3002/admin` (ou `https://seu-dominio.com.br/admin` em produção) e entre com a senha do Admin.

## Catálogo de itens (ERP)

O catálogo de itens/materiais não é mais mantido dentro desta aplicação. Toda consulta de item — auto-preenchimento de descrição em Novo Carregamento/Nova Caixa/Alterar Caixa e a listagem do painel admin — é feita **em tempo real** direto no banco do ERP (SQL Server). `GET /api/itens-materiais/codigo/:codigo` (`backend/routes/itensMateriais.js`) decide qual das duas consultas abaixo usar dependendo do formato do código lido:

| Formato do código lido | Exemplo | Consulta |
|---|---|---|
| código de catálogo "normal" | `12345` | direto em `PRO_PRODUTO` pelo `PRO_Codigo` |
| item de estrutura de engenharia **com posição** | `265545-DTV001-0463` | junção `ORD_ORDEM` + `ORD_ORDEMPRVITEM` + `PRO_PRODUTO` (ver abaixo) |

**Consulta direta (código de catálogo normal):**

| Campo do sistema | Coluna no ERP (`PRO_PRODUTO`) |
|---|---|
| código | `PRO_Codigo` |
| descrição | `PRO_Descricao` |
| quantidade | `PRO_PesoLiquido` |

**Consulta por posição** — a partir da versão em que as etiquetas de item de estrutura passaram a trazer um terceiro número no final (a posição do item dentro da ordem de produção, ex.: `265545-DTV001-0463`), o `PRO_Codigo` sozinho não identifica mais a linha certa: é preciso juntar a ordem de produção (`ORD_ORDEM`) com o item dela (`ORD_ORDEMPRVITEM`) pela posição lida. O código é dividido em duas partes pelo padrão `PADRAO_CODIGO_COM_POSICAO` (`backend/routes/itensMateriais.js`): tudo antes do último hífen vira o "produto" da ordem (`265545-DTV001`), e o que vem depois é a posição (`0463`):

```sql
SELECT TOP 1
  RTRIM(oo.ORD_OrdemNumero)     AS codigo,
  RTRIM(pp.PRO_Descricao)       AS descricao,
  oi.ORD_OrdemPrvItemQuantidade AS quantidade
FROM ORD_ORDEM AS oo
JOIN ORD_ORDEMPRVITEM AS oi
  ON oi.ORD_OrdemSequencia = oo.ORD_OrdemSequencia
JOIN PRO_PRODUTO AS pp
  ON pp.PRO_Codigo = oi.ORD_OrdemPrvItemProduto
WHERE RTRIM(oo.ORD_OrdemProduto) = @produto
  AND TRY_CAST(RTRIM(oi.ORD_OrdemPrvItemPosicao) AS INT) = TRY_CAST(@posicao AS INT)
```

O programa que gera a etiqueta descarta os zeros à esquerda da posição (ex.: código de barras termina em `-78`, mas no ERP a posição fica gravada como `0078`) — por isso a comparação da posição é numérica (`TRY_CAST ... AS INT`) em vez de texto, pra "78" e "0078" baterem como o mesmo valor. `TRY_CAST` em vez de `CAST` evita que uma posição não-numérica derrube a consulta inteira — nesse caso simplesmente não bate, como esperado.

Esse terceiro número (posição) é só para essa consulta — a busca automática do desenho técnico (ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico)) continua olhando só projeto+estrutura (`PADRAO_CODIGO_DESENHO` aceita a posição no final, mas a ignora), então continua funcionando normalmente tanto com etiquetas antigas (2 partes) quanto com as novas (3 partes, com ou sem zeros à esquerda na posição).

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
# copie o hash gerado para EXPEDICAO_PASSWORD_HASH, EM_CAMPO_PASSWORD_HASH, ALMOXARIFADO_PASSWORD_HASH, PRODUCAO_PASSWORD_HASH ou EXPEDICAO_ADMINISTRATIVO_PASSWORD_HASH no .env
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

`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `EXPEDICAO_PASSWORD_HASH`, `EM_CAMPO_PASSWORD_HASH`, `ALMOXARIFADO_PASSWORD_HASH`, `PRODUCAO_PASSWORD_HASH`, `EXPEDICAO_ADMINISTRATIVO_PASSWORD_HASH`, `ADMIN_PASSWORD_HASH`, `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_DEFAULT_SENDER`, `ROMANEIO_CAIXA_EMAIL_TO`, `ROMANEIO_CARREGAMENTO_EMAIL_TO`, `IMPRESSORA_ALMOXARIFADO_NOME`, `IMPRESSORA_EXPEDICAO_NOME`, `IMPRESSORA_ROMANEIO_NOME`, `AGENT_API_KEY`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_NAME`, `ERP_DB_USER`, `ERP_DB_PASSWORD`, `ERP_DB_ENCRYPT` — ver `backend/.env.example`.

As configurações SMTP em `backend/mail.js` são usadas para enviar automaticamente o romaneio (PDF) ao finalizar uma caixa — ver [Fluxo de caixas](#fluxo-de-caixas). As configurações `ERP_DB_*` conectam ao banco do ERP para o catálogo de itens — ver [Catálogo de itens (ERP)](#catálogo-de-itens-erp). As configurações `IMPRESSORA_*`/`AGENT_API_KEY` são usadas pela impressão automática de etiquetas (Almoxarifado e Produção compartilham `IMPRESSORA_ALMOXARIFADO_NOME`) e do romaneio das caixas de Produção (`IMPRESSORA_ROMANEIO_NOME`) — ver [Impressão de etiquetas e romaneio de Produção](#impressão-de-etiquetas-e-romaneio-de-produção). O mesmo `AGENT_API_KEY` também autentica o `desenho-agent/` — ver [Impressão automática de desenho técnico](#impressão-automática-de-desenho-técnico) (esse agente tem seu próprio `.env`, com `PASTA_PROJETOS` e `IMPRESSORA_DESENHOS_NOME` — não ficam no `.env` do backend).

## Atualizando um banco já existente

Se o banco já foi provisionado com uma versão anterior do `banco_de_dados.sql`, rode manualmente os scripts incrementais que ainda não foram aplicados, na ordem. (Scripts mais antigos que este ponto — perfil Almoxarifado, fluxo de caixas, placa no carregamento, etc. — já foram removidos do repositório por estarem totalmente mesclados no `banco_de_dados.sql`; se precisar deles para um banco muito desatualizado, consulte o histórico do git ou provisiona um banco novo direto do `banco_de_dados.sql` atual.)

```bash
mysql -u root -p burntech_expedicao < alter_remover_itens_materiais.sql # opcional — remove a tabela local, não usada desde a integração com o ERP
mysql -u root -p burntech_expedicao < alter_carregamentos_desembarque.sql # fluxo de Desembarque (perfil Em Campo)
mysql -u root -p burntech_expedicao < alter_caixas_numero_projeto.sql   # campo numero_projeto na etiqueta da caixa
mysql -u root -p burntech_expedicao < alter_carregamentos_sequencial_projeto.sql  # controle "numero_projeto-sequencial" no romaneio de carregamento
mysql -u root -p burntech_expedicao < alter_carregamentos_perfil_expedicao_administrativo.sql  # ENUM criado_por_perfil aceita o novo perfil
mysql -u root -p burntech_expedicao < alter_etiqueta_fila.sql  # fila de impressão de etiquetas (Argox)
mysql -u root -p burntech_expedicao < alter_caixas_perfil_producao.sql  # histórico — criava romaneios_producao/romaneio_producao_itens (etapa já superada, ver migrar_producao_para_caixas.sql abaixo)
mysql -u root -p burntech_expedicao < alter_romaneio_producao_impressao.sql  # histórico — fila de impressão automática do romaneio de Produção (laser A4, etapa já superada)
mysql -u root -p burntech_expedicao < alter_desenho_tecnico_impressao.sql  # fila de busca/impressão automática do desenho técnico
mysql -u root -p burntech_expedicao < migrar_producao_para_caixas.sql  # Produção passa a usar caixas/caixa_itens (idêntico a Almoxarifado) — leia os comentários no topo do arquivo antes de rodar
mysql -u root -p burntech_expedicao < alter_romaneio_impressao_fila.sql  # fila de impressão automática do romaneio de Produção (laser A4), agora ligada a caixas
```

Se o banco já rodou os dois scripts marcados como "histórico" acima (ou seja, se as tabelas `romaneios_producao`/`romaneio_producao_itens`/`romaneio_producao_impressao_fila` existem), rode `migrar_producao_para_caixas.sql` por último — ele migra os dados dessas tabelas para `caixas`/`caixa_itens` e reaponta `desenho_tecnico_impressao_fila` para os novos itens. Se o banco nunca teve o perfil Produção rodando com essa estrutura antiga (instalação nova a partir do `banco_de_dados.sql` atual), **não precisa rodar `migrar_producao_para_caixas.sql`** — o schema novo já nasce correto.

## Próximos passos (fora do escopo desta primeira versão)

- Tela dedicada de "Novo Descarregamento" (a coluna `tipo` já existe no banco, pronta para isso).
- Envio de e-mail de notificação ao registrar um carregamento.
