# Rodar o Conflui no Windows e VS Code

O MVP usa **Python + frontend JavaScript + SQLite em arquivo**. O banco já vem com o Python: você não precisa instalar ou iniciar um servidor de banco. O design e as funcionalidades da interface foram preservados.
Ou pelo navegador 
**MVP:** https://conflui-feraligatr-production.up.railway.app  
Para melhor experiência entrar com o login email:clara.castrosts@gmail.com|senha:Cc@840352170612

**Código-fonte:** https://github.com/Claracastr/Conflui-feraligatr  
**Guia de instalação:** [README_INSTRUCOES_EXECUCAO.md](README_INSTRUCOES_EXECUCAO.md)

## Demonstração da câmera — ThermoCount IA (execução independente)

O repositório inclui uma demonstração experimental de **visão computacional**, desenvolvida para mostrar como a captura de uma câmera pode ser utilizada para detectar pessoas, acompanhar contagens e gerar um mapa de calor da área filmada.

### Como visualizar

1. No GitHub, baixe o repositório pelo botão **Code → Download ZIP** e extraia os arquivos. **O visualizador de código do GitHub não executa o HTML**.
2. Abra a pasta **`Prototipos`** do projeto.
3. Localize o arquivo **`thermocount_fps_otimizado`**.
4. Clique duas vezes no arquivo para abri-lo no **Google Chrome** ou **Microsoft Edge**. Se necessário, clique com o botão direito → **Abrir com** → navegador.
5. Com acesso à internet, aguarde a mensagem **“câmera desligada · IA pronta”**, que indica o carregamento dos modelos.
6. Clique em **Abrir câmera** e permita o acesso à câmera quando solicitado.
7. Observe a **imagem da câmera**, as **marcações de detecção**, a **contagem de pessoas**, o **acumulado** e o **mapa de calor**. O botão **Zerar contagem** reinicia os valores da demonstração.

**Requisitos:** navegador atualizado, internet para carregar os modelos externos e câmera disponível com autorização do navegador. Caso a câmera seja bloqueada ao abrir o arquivo diretamente (`file://`), abra-o através de um servidor local em `localhost`, ou verifique as permissões de câmera do navegador.

**O que este protótipo demonstra:** detecção e contabilização de pessoas no navegador, com mapa de calor da imagem capturada. A opção **“Estimar sexo aparente”** é experimental, pode apresentar erros e **não é necessária** para a demonstração principal; recomenda-se deixá-la desativada.

**Limite da integração:** ThermoCount IA é uma **prova de conceito independente**, não uma câmera conectada ao shopping. O protótipo não atualiza automaticamente o banco, a API ou o mapa por setores do Conflui. A aplicação utiliza bibliotecas e modelos externos carregados pela internet, sem exigir instalação local dessas dependências.

## 1. Preparação

Instale Python **3.12**, Node.js **22** e VS Code. Extraia o ZIP atualizado e abra no VS Code a pasta `Conflui`, que contém `configurar.py`, `iniciar.py`, `backend` e `frontend`.

No VS Code, abra **Terminal → Novo terminal**. Use **Command Prompt / Prompt de Comando** na setinha ao lado do `+`. Os comandos abaixo são para esse terminal, começando na **pasta principal do projeto**.

## 2. Configurar o backend — só na primeira vez

Execute um comando por vez:

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r backend\requirements.txt
python configurar.py
```

O último comando:

- Cria o `.env` e gera a chave interna do simulador automaticamente.
- Cria o arquivo de banco `conflui.db` na raiz e aplica as migrations.
- Cadastra os pavimentos e as regiões da planta.
- Preenche três dias de histórico sintético para testar o calendário.
- Pede seu e-mail e a senha para criar o administrador, se não houver um.

A senha precisa ter pelo menos 12 caracteres. **Ela não aparece enquanto você digita**, o que é normal. Não existe senha padrão.

Executar `configurar.py` novamente preserva a conta e os registros existentes; ele não apaga o banco. Se você copiou um `.env` da versão anterior com outro banco, o script atualiza a configuração para SQLite. Ele não acessa nem migra os dados daquele banco externo.

## 3. Iniciar o backend

No mesmo terminal, ainda na **pasta principal** e com `(.venv)` ativo:

```bat
python iniciar.py
```

Deixe esse terminal aberto. O comando inicia a API e, no ambiente simulado, o simulador em processos separados. Você não precisa de outro terminal para o simulador.

Confira http://127.0.0.1:8000/health — deve responder com `status: ok` e `data_mode: simulator`.

## 4. Iniciar a interface

Abra um **segundo terminal** na pasta principal:

```bat
cd frontend
npm ci
npm run dev
```

Abra **http://localhost:5173** e entre com a conta criada no passo 2.

O `npm ci` só precisa ser repetido na primeira execução ou quando mudar o arquivo de dependências. O frontend encaminha as consultas `/api/` para a API local na porta 8000.

## 5. Conferir se funcionou

- O primeiro terminal mostra o envio de medições dos 18 setores.
- O mapa recebe contagens e posições da API; o cabeçalho identifica os dados simulados.
- Abra a busca e digite enquanto chegam atualizações: o foco deve permanecer.
- No histórico, escolha hoje, ontem ou anteontem, que foram preenchidos na configuração.
- Troque o pavimento mantendo a data e o horário selecionados.
- Cadastre um evento, favorite um setor e atualize a página para conferir a persistência.
- Consulte o perfil do público: ele usa uma amostra sintética independente da ocupação. Um evento recém-criado pode não ter pesquisa e retornar indisponibilidade.

Os números do simulador não representam câmeras conectadas. Uma data sem registros não é preenchida com zero.

## 6. Encerrar e abrir novamente

Pressione **Ctrl+C** em cada um dos dois terminais. No terminal do backend, esse comando encerra também o simulador. O arquivo `conflui.db` mantém os registros.

Na próxima vez, **Terminal 1 — raiz**:

```bat
.venv\Scripts\activate.bat
python iniciar.py
```

**Terminal 2 — raiz**:

```bat
cd frontend
npm run dev
```

Não precisa recriar o banco ou o administrador.

## Testes e Postman

**Raiz, ambiente Python ativo:**

```bat
cd backend
python -m pytest -q
```

A suíte usa arquivos SQLite temporários próprios e não altera seu banco da aplicação.

**Dentro de `frontend`:**

```bat
npm test
npm run build
```

No Postman, importe os dois JSONs da pasta `postman`, selecione o ambiente local e preencha e-mail/senha. Para testar aquisição manualmente, copie `INGEST_KEY` do `.env` para o campo local do ambiente Postman. Não envie esses valores ao GitHub. Execute Saúde → Login → Administrador atual, e depois as consultas. O cookie é preservado pelo Postman.

## Vídeo, somente quando a equipe estiver pronta

O detector continua opcional e não é instalado para executar o MVP. Ele depende de vídeo, pesos pré-treinados e validação no equipamento. Para o piloto, use um arquivo separado de banco, configure `DATA_MODE=video` no `.env`, execute `python configurar.py` e registre a câmera pela API conforme [CONTRATOS.md](CONTRATOS.md). No modo de vídeo, `iniciar.py` não inicia o simulador.

Para instalar o detector, na raiz com o ambiente ativo:

```bat
python -m pip install -r backend\requirements-video.txt
```

Com a API aberta, em outro terminal dentro de `backend`:

```bat
python -m conflui.video --input "C:\videos\teste.mp4" --camera camera-cinema --sector cinema
```

A câmera precisa ter sido cadastrada. Sem calibração, o processador envia somente contagem, sem inventar calor sobre a planta. A API de câmeras da equipe ainda precisa ser disponibilizada para um adaptador específico.

## Erros mais comuns

| Erro | Como resolver |
| --- | --- |
| `py` ou `node` não reconhecido | Confira a instalação no PATH e reabra o VS Code. |
| PowerShell bloqueia a ativação | Use o terminal Command Prompt indicado acima, sem alterar políticas do computador. |
| Não encontra `configurar.py` | O terminal precisa estar na pasta principal, que contém esse arquivo. |
| `ModuleNotFoundError` | Ative `.venv` e instale `backend\requirements.txt`. |
| Banco ainda não configurado | Rode `python configurar.py` na raiz. |
| A API não responde | Confira as mensagens no primeiro terminal e se a porta 8000 está livre. |
| Login retorna 401 | Use o e-mail e a senha criados na configuração, no mesmo arquivo de banco. |
| Sem registros no histórico | Escolha um dos três dias preenchidos ou gere outro período com `python -m conflui.cli seed-history`, dentro de `backend`. |
| Banco bloqueado | Encerre instâncias duplicadas e ferramentas externas que estejam mantendo uma transação aberta. Não execute a configuração durante a apresentação. |
| `.env` ainda aponta para o banco anterior | Encerre a API, execute `python configurar.py` e inicie novamente. |

Para copiar o banco como backup, primeiro encerre o backend. Depois copie `conflui.db`. Não apague esse arquivo para simplesmente encerrar o sistema.

O site anteriormente publicado continua como referência visual. Esta versão integrada é executada localmente; os arquivos não foram enviados automaticamente ao GitHub.
