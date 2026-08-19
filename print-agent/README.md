# Agente de impressão de etiquetas — Central Expedição

Programa que roda no "computador-ponte" (o computador sempre ligado, na
mesma rede das impressoras Argox OS-214 Plus) e imprime automaticamente
as etiquetas de caixa geradas pelo Central Expedição.

## Como funciona

O app (celular) não imprime diretamente — ele só avisa o servidor
"imprima a etiqueta da caixa X". O servidor gera o PDF da etiqueta
(100mm x 70mm, com código de barras) e guarda o pedido numa fila.

Este agente, rodando aqui no computador-ponte, fica perguntando ao
servidor "tem etiqueta pra imprimir?" a cada poucos segundos. Quando
tem, ele baixa o PDF e manda direto pra impressora Argox certa —
Almoxarifado ou Expedição, sem abrir nenhuma janela nem pedir
confirmação.

Só existem duas impressoras configuradas: uma para o perfil
Almoxarifado, outra para o perfil Expedição.

## Pré-requisitos

- Windows (o agente usa o SumatraPDF por baixo, que só funciona em Windows)
- [Node.js](https://nodejs.org/) versão 18 ou mais recente instalado
- As duas impressoras Argox instaladas no Windows deste computador, cada
  uma com o nome exato configurado no servidor:
  - `Argox-Almoxarifado`
  - `Argox-expedicao`

  Para ver o nome exato de uma impressora, abra **Configurações →
  Bluetooth e dispositivos → Impressoras e scanners** e confira o nome
  como aparece lá (ou rode `wmic printer get name` num prompt de
  comando). Se os nomes não baterem exatamente com os de cima, avise
  para ajustar `IMPRESSORA_ALMOXARIFADO_NOME` / `IMPRESSORA_EXPEDICAO_NOME`
  no `.env` do servidor.

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

   Se aparecer `Agente de impressão iniciado. Consultando ... a cada 5s.`
   e nenhum erro, está funcionando. Gere uma etiqueta pelo app (Nova
   Caixa → Salvar → Finalizar, ou o botão "Reimprimir" no detalhe de
   uma caixa) e confirme que ela sai na impressora certa.

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
- **Etiqueta não sai, mas o agente não mostra erro** — confira se
  existem pedidos pendentes de fato (peça pro servidor confirmar via
  `SELECT * FROM etiqueta_fila WHERE status='pendente'`) e se o
  `AGENT_API_KEY` bate exatamente com o do servidor (chave errada dá
  HTTP 401 nos logs do agente).
- **Erro ao imprimir mencionando o nome da impressora** — o nome
  configurado no servidor (`IMPRESSORA_ALMOXARIFADO_NOME` /
  `IMPRESSORA_EXPEDICAO_NOME`) tem que ser idêntico, caractere por
  caractere, ao nome da impressora no Windows.
- **Etiqueta sai cortada ou em tamanho errado** — confirme que o driver
  da Argox está configurado para o tamanho de página 100mm x 70mm (o
  PDF já vem exatamente nesse tamanho; o agente imprime com
  `scale: "noscale"`, sem redimensionar).
