# Agente de desenho técnico — Central Expedição

Programa que roda numa máquina da rede interna com acesso ao servidor
de arquivos on-premises (`D:\Engenharia\...`) e imprime automaticamente
o desenho técnico (PDF) de cada item lido no romaneio de Produção,
quando o código do item corresponde a uma estrutura de engenharia.

## Como funciona

Quando um item é lido/adicionado no romaneio de Produção, o app não
sabe nada sobre pastas nem arquivos — ele só manda o código do item
pro backend (ex.: `250013-DGA109`). Se esse código bater com o padrão
`NNNNNN-LLLddd` (6 dígitos do projeto + hífen + 3 letras da estrutura +
número), o backend registra um pedido de busca na tabela
`desenho_tecnico_impressao_fila`.

Este agente, rodando aqui, fica perguntando ao servidor "tem desenho
pra buscar?" a cada poucos segundos. Quando tem, ele:

1. Procura, dentro de `PASTA_PROJETOS`, uma subpasta que **comece** com
   o número do projeto (ex.: `250013-HRS02510T - Frivatti`).
2. Dentro dela, procura uma subpasta que **comece** com as 3 letras da
   estrutura (ex.: `DGA - Dutos de Gases e Ar`).
3. Dentro dela, procura um `.pdf` cujo nome contenha o projeto e o
   código completo da estrutura, terminando em `-R<número>.pdf` (ex.:
   `250013-HRS02510T-DGA109-R00.pdf`). Se houver mais de uma revisão
   (R00, R01, R02...), sempre imprime a **mais alta**.
4. Manda o PDF (todas as páginas) direto pra impressora configurada,
   sem diálogo de impressão.

Se qualquer passo falhar (pasta não encontrada, mais de uma pasta
"batendo" com o prefixo, arquivo não encontrado), o agente registra o
motivo de volta no servidor e segue pro próximo pedido — não trava a
fila nem o app.

Diferente do `print-agent/` (etiqueta e romaneio), aqui o backend
**não gera nem guarda o PDF** — ele só sabe que existe um pedido; quem
busca o arquivo de verdade e imprime é este agente, sozinho.

## Pré-requisitos

- Windows (o agente usa o SumatraPDF por baixo, via `pdf-to-printer`,
  que só funciona em Windows)
- [Node.js](https://nodejs.org/) versão 18 ou mais recente instalado
- Esta máquina precisa enxergar a pasta `PASTA_PROJETOS` (local, tipo
  `D:\...`, ou uma unidade de rede mapeada) — teste abrindo essa pasta
  pelo Explorador de Arquivos antes de configurar o agente.
- Esta máquina precisa também enxergar a impressora a laser do
  romaneio de Produção (a mesma do `print-agent/`, compartilhada na
  rede do Windows e instalada/conectada aqui também) — confira em
  **Configurações → Bluetooth e dispositivos → Impressoras e
  scanners** o nome exato como aparece NESTA máquina (pode ser
  diferente do nome usado no computador do Almoxarifado).

## Instalação

1. Copie esta pasta `desenho-agent/` inteira para a máquina escolhida.
2. Abra um Prompt de Comando (ou PowerShell) dentro da pasta e rode:

   ```
   npm install
   ```

3. Copie `.env.example` para `.env` e preencha:

   ```
   API_URL=https://seu-dominio.com.br
   AGENT_API_KEY=<mesma chave que está em AGENT_API_KEY no backend/.env do servidor>
   PASTA_PROJETOS=D:\Engenharia\0 - Engenharia do Produto\02 - Projetos\
   IMPRESSORA_DESENHOS_NOME=<nome exato da impressora, como aparece nesta máquina>
   ```

4. Teste rodando manualmente:

   ```
   npm start
   ```

   Se aparecer `Agente de desenho técnico iniciado. Consultando ... a
   cada 5s.` e nenhum erro, está funcionando. Leia um item com código
   de estrutura (ex.: `250013-DGA109`) no romaneio de Produção e
   confirme que o desenho sai na impressora certa.

## Deixar rodando sempre (sem precisar abrir manualmente)

Mesma recomendação do `print-agent/`: use o **Agendador de Tarefas do
Windows**.

1. Abra o **Agendador de Tarefas** → **Criar Tarefa Básica**.
2. Nome: `Central Expedição - Agente de Desenho Técnico`.
3. Disparador: **Ao fazer logon** (ou **Na inicialização do computador**).
4. Ação: **Iniciar um programa**.
   - Programa/script: `node`
   - Argumentos: `agent.js`
   - Iniciar em: o caminho completo da pasta `desenho-agent` (ex:
     `C:\DesenhoAgent\desenho-agent`)
5. Nas propriedades da tarefa, marque **"Executar estando o usuário
   conectado ou não"** e, na aba **Configurações**, marque **"Reiniciar
   a tarefa se ela falhar"** a cada poucos minutos.

## Solução de problemas

- **"API_URL não configurada" / "AGENT_API_KEY não configurada" /
  "PASTA_PROJETOS não configurada" / "IMPRESSORA_DESENHOS_NOME não
  configurada"** — o `.env` não foi criado ou está incompleto. Confira
  o passo 3 acima.
- **"Pasta do projeto ... não encontrada"** — confira se
  `PASTA_PROJETOS` está correto e se existe mesmo uma subpasta
  começando com aquele número de projeto ali dentro.
- **"Mais de uma pasta ... encontrada (ambíguo)"** — existe mais de
  uma subpasta cujo nome começa com o mesmo prefixo (projeto ou
  estrutura); o agente não imprime nesse caso, pra não arriscar
  imprimir o desenho errado. É preciso ajustar manualmente o nome de
  uma das pastas duplicadas no servidor de arquivos.
- **"Nenhum arquivo ... encontrado"** — o PDF não existe na pasta da
  estrutura com o padrão esperado (`PROJETO-...-ESTRUTURA-R##.pdf`).
  Confira o nome do arquivo real no servidor.
- **Erro ao imprimir mencionando o nome da impressora** — o valor de
  `IMPRESSORA_DESENHOS_NOME` tem que ser idêntico, caractere por
  caractere, ao nome da impressora como aparece NESTA máquina (pode
  ser diferente do nome visto no computador do Almoxarifado, mesmo
  sendo a mesma impressora física).
