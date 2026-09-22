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
   sem diálogo de impressão — sempre em papel A4, encolhendo o
   conteúdo pra caber inteiro na página (o desenho do CAD quase nunca
   já vem no tamanho A4; ver "Desenho saindo cortado" abaixo).

Se qualquer passo falhar (pasta não encontrada, mais de uma pasta
"batendo" com o prefixo, arquivo não encontrado), o agente registra o
motivo de volta no servidor e segue pro próximo pedido — não trava a
fila nem o app.

Diferente do `print-agent/` (etiqueta e romaneio), aqui o backend
**não gera nem guarda o PDF** — ele só sabe que existe um pedido; quem
busca o arquivo de verdade e imprime é este agente, sozinho.

### Perfil Pintura — impressão de TODOS os desenhos de uma estrutura

Este mesmo agente também atende o perfil Pintura, que pede a impressão
de **todos** os desenhos de uma estrutura de uma vez (não um item
específico) — tela "Imprimir Desenhos", campo "Projeto" no formato
`NNNNNN-LLLnnn` (ex.: `250492-TCR500`). O agente consulta
`GET /api/desenhos-tecnicos-lote/pendentes` no mesmo ciclo e, pra cada
pedido:

1. Acha a pasta do projeto e a pasta da estrutura do mesmo jeito
   (passos 1 e 2 acima).
2. Verifica se existe, dentro da pasta da estrutura, mais uma subpasta
   batizada com o código completo informado (ex.: `TCR-500` dentro de
   `TCR - Transportador de Correia de Roletes`) — algumas estruturas
   são divididas em faixas assim, cada subpasta só com os PDFs daquela
   faixa (`TCR500` a `TCR595`, por exemplo). Se existir, a busca fica
   restrita a essa subpasta; se não existir, busca direto na pasta da
   estrutura mesmo.
3. Varre essa pasta **e todas as suas subpastas** atrás de qualquer
   `.pdf`, agrupa pelo nome da peça (tudo antes do `-R<número>` final)
   e fica só com a revisão mais alta de cada uma.
4. Imprime cada PDF escolhido, em sequência, na mesma impressora
   (`IMPRESSORA_DESENHOS_NOME`, mesmas opções `scale: "fit"` +
   `paperSize: "A4"`), e reporta de volta quantos imprimiram com
   sucesso e quantos falharam.

Se a busca falhar antes de achar qualquer PDF (pasta não encontrada,
ambígua, pasta vazia), o pedido fica marcado como erro na fila, igual
ao fluxo de item único.

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
   cada 5s.` e nenhum erro, está funcionando. Teste os dois fluxos:
   - **Produção**: leia um item com código de estrutura (ex.:
     `250013-DGA109`) no romaneio de Produção e confirme que o desenho
     sai na impressora certa.
   - **Pintura**: na tela "Imprimir Desenhos", informe um projeto+
     estrutura existente (ex.: `250492-TCR500`) e confirme que todos os
     desenhos daquela estrutura saem na impressora, um atrás do outro.

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
- **"Mais de uma pasta de subpasta da faixa ... encontrada (ambíguo)"**
  — mesma ideia do erro de ambiguidade acima, só que na subpasta que
  agrupa uma faixa de peças do perfil Pintura (ex.: duas pastas
  batendo com o código completo "TCR500"). Ajuste os nomes das pastas
  duplicadas no servidor de arquivos.
- **"Nenhum PDF encontrado em ..."** (perfil Pintura) — a pasta da
  estrutura (ou da subpasta da faixa, se existir uma) não tem nenhum
  arquivo `.pdf`, nem nas subpastas dela. Confira se o projeto e a
  estrutura foram digitados certos e se os arquivos realmente estão
  nessa pasta no servidor.
- **Desenho saindo cortado/fora do esquadro do papel A4** — o agente já
  manda `scale: "fit"` (encolhe o conteúdo pra caber na página) e
  `paperSize: "A4"` (força a página impressa a ser A4, mesmo que o PDF
  do CAD tenha sido exportado em A3/A1/A0) pro SumatraPDF. Se mesmo
  assim continuar cortando, confira: (1) se `desenho-agent/agent.js`
  na máquina realmente é esta versão atualizada (redeploy manual,
  não é publicado junto com o backend); (2) o papel carregado na
  bandeja é A4 mesmo, e não um tamanho menor configurado por engano no
  driver da impressora; (3) as margens não-imprimíveis da impressora —
  se o desenho tiver conteúdo bem rente à borda, pode aparecer cortado
  nos poucos milímetros que a impressora fisicamente não alcança,
  mesmo com "fit" ativo.
