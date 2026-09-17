# Agente de impressão — Central Expedição

Programa que roda no "computador-ponte" (o computador sempre ligado, na
mesma rede/USB das impressoras) e imprime automaticamente tanto as
etiquetas de caixa quanto o romaneio das caixas do perfil Produção,
gerados pelo Central Expedição.

## Como funciona

O app (celular) não imprime diretamente — ele só avisa o servidor
"imprima a etiqueta da caixa X" ou "gere o romaneio Y". O servidor gera
o PDF (etiqueta 100mm x 70mm com código de barras, ou romaneio A4) e
guarda o pedido numa fila — uma fila pra cada tipo (`etiqueta_fila` e
`romaneio_impressao_fila`).

Este agente, rodando aqui no computador-ponte, fica perguntando ao
servidor "tem algo pra imprimir?" a cada poucos segundos — consultando
as DUAS filas no mesmo ciclo. Quando tem, ele baixa o PDF e manda
direto pra impressora certa, sem abrir nenhuma janela nem pedir
confirmação.

Existem três impressoras configuradas, todas neste mesmo computador:

- Uma Argox para os perfis Almoxarifado e Produção (etiqueta de caixa
  — os dois perfis usam a MESMA impressora/fila, não são duas Argox
  diferentes)
- Uma Argox para o perfil Expedição (etiqueta de caixa)
- Uma impressora a laser comum, papel A4 (romaneio das caixas do
  perfil Produção — só esse perfil dispara essa impressão automática)

## Pré-requisitos

- Windows (o agente usa o SumatraPDF por baixo, que só funciona em Windows)
- [Node.js](https://nodejs.org/) versão 18 ou mais recente instalado
- As três impressoras instaladas no Windows deste computador, cada uma
  com o nome exato configurado no servidor:
  - `Argox-Almoxarifado` (etiqueta, Almoxarifado e Produção)
  - `Argox-expedicao` (etiqueta, Expedição)
  - a impressora a laser (romaneio de Produção) — nome definido em
    `IMPRESSORA_ROMANEIO_NOME`, sem valor padrão fixo

  Para ver o nome exato de uma impressora, abra **Configurações →
  Bluetooth e dispositivos → Impressoras e scanners** e confira o nome
  como aparece lá (ou rode `wmic printer get name` num prompt de
  comando). Se os nomes não baterem exatamente com os de cima, avise
  para ajustar `IMPRESSORA_ALMOXARIFADO_NOME` / `IMPRESSORA_EXPEDICAO_NOME`
  / `IMPRESSORA_ROMANEIO_NOME` no `.env` do servidor.

## Instalação

1. Copie esta pasta `print-agent/` inteira para o computador-ponte.
2. Abra um Prompt de Comando (ou PowerShell) dentro da pasta e rode:

   ```
   npm install
   ```

3. Copie `.env.example` para `.env` e preencha:

   ```
   API_URL=https://seu-dominio.com.br
   AGENT_API_KEY=<mesma chave que está em AGENT_API_KEY no backend/.env do servidor>
   ```

4. Teste rodando manualmente:

   ```
   npm start
   ```

   Se aparecer `Agente de impressão iniciado. Consultando ... a cada 5s
   (filas: etiqueta, romaneio).` e nenhum erro, está funcionando. Teste
   os dois fluxos:
   - **Etiqueta**: Nova Caixa → Salvar → Finalizar (ou o botão
     "Reimprimir" no detalhe de uma caixa, em qualquer um dos três
     perfis — Almoxarifado, Expedição ou Produção) e confirme que ela
     sai na impressora Argox certa.
   - **Romaneio de Produção**: finalize uma caixa no perfil Produção e
     clique em "🧾 Romaneio" — confirme que ele sai na impressora a
     laser, além de baixar o PDF e chegar por e-mail, e que os
     desenhos técnicos dos itens da caixa também saem na impressora do
     `desenho-agent/` (ver `desenho-agent/README.md`).

## Deixar rodando sempre (sem precisar abrir manualmente)

Como este computador precisa ficar sempre ligado e este agente sempre
rodando, recomenda-se configurar para iniciar sozinho com o Windows.
A forma mais simples é usar o **Agendador de Tarefas do Windows**:

1. Abra o **Agendador de Tarefas** → **Criar Tarefa Básica**.
2. Nome: `Central Expedição - Agente de Impressão`.
3. Disparador: **Ao fazer logon** (ou **Na inicialização do computador**).
4. Ação: **Iniciar um programa**.
   - Programa/script: `node`
   - Argumentos: `agent.js`
   - Iniciar em: o caminho completo da pasta `print-agent` (ex:
     `C:\PrintAgent\print-agent`)
5. Nas propriedades da tarefa, marque **"Executar estando o usuário
   conectado ou não"** e, na aba **Configurações**, marque **"Reiniciar
   a tarefa se ela falhar"** a cada poucos minutos — assim, se o agente
   travar ou o computador reiniciar, ele volta sozinho.

Alternativa: usar o [PM2](https://pm2.keymetrics.io/) (`npm install -g
pm2`, depois `pm2 start agent.js` e `pm2 save` + `pm2-startup`) se
preferir um gerenciador de processos mais robusto — mas o Agendador de
Tarefas já resolve bem para este caso.

## Solução de problemas

- **"API_URL não configurada" / "AGENT_API_KEY não configurada"** — o
  `.env` não foi criado ou está incompleto. Confira o passo 3 acima.
- **Etiqueta/romaneio não sai, mas o agente não mostra erro** — confira
  se existem pedidos pendentes de fato (peça pro servidor confirmar via
  `SELECT * FROM etiqueta_fila WHERE status='pendente'` ou
  `SELECT * FROM romaneio_impressao_fila WHERE status='pendente'`,
  conforme o caso) e se o `AGENT_API_KEY` bate exatamente com o do
  servidor (chave errada dá HTTP 401 nos logs do agente).
- **Erro ao imprimir mencionando o nome da impressora** — o nome
  configurado no servidor (`IMPRESSORA_ALMOXARIFADO_NOME` /
  `IMPRESSORA_EXPEDICAO_NOME` / `IMPRESSORA_ROMANEIO_NOME`) tem que ser
  idêntico, caractere por caractere, ao nome da impressora no Windows.
- **Etiqueta sai cortada ou em tamanho errado** — confirme que o driver
  da Argox está configurado para o tamanho de página 100mm x 70mm (o
  PDF já vem exatamente nesse tamanho; o agente imprime com
  `scale: "noscale"`, sem redimensionar).
- **Romaneio sai cortado ou em papel errado** — confirme que o driver
  da impressora a laser está configurado com A4 como tamanho de papel
  padrão (o agente não força tamanho/orientação nesse job, deixa o
  SumatraPDF ajustar ao papel configurado no driver).
