# Conflui — Instruções de instalação e execução

> Guia de reprodução do MVP em **Windows com VS Code**, utilizando **Python, Node.js e SQLite**. Os comandos estão escritos para o terminal **Prompt de Comando (CMD)**, não PowerShell.

**MVP publicado:** https://conflui-feraligatr-production.up.railway.app  
**Repositório:** https://github.com/Claracastr/Conflui-feraligatr  
**Arquitetura:** [README_DOCUMENTACAO_TECNICA.md](README_DOCUMENTACAO_TECNICA.md)

## 1. Pré-requisitos

Instale:

- **Git**, para obter o repositório;
- **Python 3.12**, com `py` disponível no terminal;
- **Node.js 22** e **npm**;
- **VS Code** (recomendado), ou outro editor.

O banco é um arquivo **SQLite**: não é necessário instalar MySQL, PostgreSQL ou outro servidor de banco para reproduzir a demonstração local.

Verifique as ferramentas no CMD:

```bat
git --version
py -3.12 --version
node --version
npm --version
```

## 2. Baixar o código

No terminal:

```bat
git clone https://github.com/Claracastr/Conflui-feraligatr.git
cd Conflui-feraligatr
```

Abra essa pasta no VS Code. Os comandos seguintes partem da **raiz do projeto**, que contém `configurar.py`, `iniciar.py`, `backend/` e `frontend/`.

## 3. Preparar o backend — primeira execução

Crie o ambiente virtual, ative-o e instale as dependências:

```bat
py -3.12 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r backend\requirements.txt
```

Em seguida, execute o configurador incluído no projeto:

```bat
python configurar.py
```

O configurador foi desenvolvido para:

1. Criar/ajustar o arquivo `.env` a partir da configuração local.
2. Gerar uma chave interna de ingestão quando ainda não existir.
3. Aplicar as **migrações Alembic** ao SQLite local.
4. Cadastrar o catálogo dos pavimentos e regiões.
5. Inserir histórico sintético inicial para a demonstração.
6. Solicitar e-mail e senha para a conta administrativa, quando necessária.

A senha administrativa deve ter **pelo menos 12 caracteres**. Não existe senha padrão. O banco e os dados existentes são preservados em novas execuções normais do configurador.

> **Segurança:** nunca envie `.env`, chaves, senhas ou arquivos `.db` para o GitHub. Para um teste local, utilize exclusivamente valores e bancos locais, sem apontar para produção.

## 4. Iniciar a API e o simulador

No **terminal 1**, na raiz do projeto e com `(.venv)` ativo:

```bat
python iniciar.py
```

Esse launcher inicia a **API FastAPI** e, quando `DATA_MODE=simulator`, o processo responsável por alimentar as medições sintéticas. **Deixe o terminal aberto.**

Abra no navegador:

- **Saúde da API:** http://127.0.0.1:8000/health
- **Documentação interativa:** http://127.0.0.1:8000/docs

A rota de saúde deve retornar um status de sucesso, incluindo a identificação do modo de dados.

## 5. Iniciar o frontend

Abra o **terminal 2**, também na raiz do projeto:

```bat
cd frontend
npm ci
npm run dev
```

Acesse: **http://localhost:5173**.

O Vite encaminha as chamadas `/api` à API local na porta `8000`. Se o frontend abrir, mas exibir erro de API, confira primeiro se o terminal 1 continua em execução e se o proxy do Vite aponta para a porta correta.

## 6. Verificar o MVP

Faça este percurso de conferência:

1. Abra a tela de login e use **Explorar demonstração**, se disponível na versão clonada.
2. Verifique o **mapa de calor**, os pavimentos e os setores.
3. Abra **Calendário e Histórico**, selecione uma data com registros e mova o controle entre **09h e 00h**.
4. Consulte **eventos**, **relatórios** e o **perfil do público**.
5. Faça uma consulta suportada pelo **assistente inteligente** e confira a resposta.
6. Entre com a conta **administrativa** criada na configuração e teste uma operação de escrita permitida; recarregue a página para verificar a persistência.
7. Na sessão demonstrativa, confirme que ações administrativas de escrita continuam bloqueadas.

**Nota:** os números exibidos no modo `simulator` são sintéticos. Para verificar uma câmera real, utilize o procedimento opcional indicado na seção 9.

## 7. Parar e reiniciar

Para encerrar, pressione **Ctrl + C** nos terminais do frontend e backend.

Nas próximas execuções, **não recrie o banco nem o usuário**. Na raiz:

**Terminal 1:**

```bat
.venv\Scripts\activate.bat
python iniciar.py
```

**Terminal 2:**

```bat
cd frontend
npm run dev
```

O SQLite mantém os registros após encerrar a aplicação.

## 8. Testes e build

Com as dependências instaladas:

**Backend — execute na raiz:**

```bat
cd backend
python -m pytest -q
cd ..
```

**Frontend — execute na raiz:**

```bat
cd frontend
npm test
npm run build
cd ..
```

Esses comandos verificam, respectivamente, testes Python, testes JavaScript e compilação do frontend. Os testes de backend usam bases temporárias próprias e não devem alterar o banco principal.

Para detalhes sobre cobertura e limitações da validação, consulte `docs/VALIDACAO.md` no repositório.

## 9. Execução opcional com vídeo/câmera

**Não é necessária para rodar o MVP demonstrativo.** A prova de conceito com vídeo deve ser preparada em **outro banco** e com o modo `DATA_MODE=video`, evitando misturar dados reais e simulados.

Pré-requisitos adicionais:

- Dependências opcionais do processador de vídeo;
- câmera cadastrada na API;
- fonte de vídeo acessível;
- calibração espacial validada, caso seja necessário gerar calor por posição.

Instale as dependências opcionais a partir da raiz:

```bat
python -m pip install -r backend\requirements-video.txt
```

Depois de configurar um ambiente de vídeo separado e iniciar a API, um exemplo de execução do processador, **a partir da pasta `backend`**, é:

```bat
python -m conflui.video --input "C:\videos\teste.mp4" --camera camera-cinema --sector cinema
```

Os identificadores do exemplo precisam existir na configuração. A descrição completa do contrato de câmera, ingestão e calibração está em `docs/CONTRATOS.md`. **Não trate uma demonstração de vídeo como validação de precisão em ambiente real.**

## 10. Implantação pública

A publicação de referência utiliza **Docker e Railway**. Para reproduzir a hospedagem, consulte `Dockerfile`, `deploy.py` e `GUIA-HOSPEDAGEM.md` na raiz do repositório.

Antes da avaliação, confirme que:

- o serviço do Railway está **Online**;
- o domínio público abre em uma janela anônima;
- a sessão de demonstração acessa os módulos previstos;
- as credenciais e as chaves ficam em variáveis de ambiente;
- o banco persistente não é substituído por um SQLite local de teste.

## 11. Problemas frequentes

| Sintoma | Verificação ou solução |
| --- | --- |
| `py` não é reconhecido | Instale Python 3.12 e confira o PATH. |
| O terminal não ativa `.venv` | Abra um terminal **CMD** e use `.venv\Scripts\activate.bat`. |
| `ModuleNotFoundError` | Verifique a ativação do ambiente e reinstale `backend\requirements.txt`. |
| `no such table: admins` ou `sessions` | Pare o backend e execute `python configurar.py` **na raiz**, com o banco local correto. |
| `alembic` procura `migrations` no lugar errado | Prefira `python configurar.py`, que informa explicitamente a localização das migrações. |
| API indisponível | Verifique `http://127.0.0.1:8000/health` e o terminal da API. |
| Vite abre, mas não encontra a API | Confirme o proxy `/api` e a porta `8000`. |
| Não há dados no histórico | Selecione um dos dias semeados no setup; datas sem registro podem aparecer indisponíveis. |
| Login falha | Use o administrador criado no **mesmo banco** durante a configuração. |
| Build falha | Execute `npm ci` na pasta `frontend` e repita `npm run build`. |

## 12. Referências

- [`README.md`](https://github.com/Claracastr/Conflui-feraligatr) — apresentação geral do projeto.
- [`docs/EXECUCAO.md`](https://github.com/Claracastr/Conflui-feraligatr/blob/main/docs/EXECUCAO.md) — documentação operacional do repositório.
- [`docs/CONTRATOS.md`](https://github.com/Claracastr/Conflui-feraligatr/blob/main/docs/CONTRATOS.md) — especificações da API.
- [`docs/VALIDACAO.md`](https://github.com/Claracastr/Conflui-feraligatr/blob/main/docs/VALIDACAO.md) — testes e limites da validação.
- [`postman/`](https://github.com/Claracastr/Conflui-feraligatr/tree/main/postman) — coleção e ambiente para consultas à API.

---

**Conflui — HackaRun**  
O procedimento acima documenta a execução reproduzível do MVP. Caso a branch publicada tenha mudanças posteriores, os comandos e as rotas devem ser conferidos contra essa versão antes da entrega oficial.
