# Conflui — GitHub + Railway

Esta pasta é uma **cópia preparada para deploy**, sem o `.env`, banco de dados, ambiente virtual ou credenciais do computador original.

## 1. GitHub
1. Crie um repositório privado no GitHub chamado `conflui`.
2. Abra esta pasta (`Conflui-pronto-para-Railway`) no VS Code e abra o terminal.
3. Execute `git init`, `git add .`, `git commit -m "Preparar Conflui para Railway"`.
4. Conecte ao endereço que o GitHub forneceu: `git remote add origin https://github.com/SEU_USUARIO/conflui.git`.
5. Envie com `git branch -M main` e `git push -u origin main`.
6. **Não publique** o `.env` antigo, `conflui.db` nem chaves pessoais. O `.gitignore` já os exclui.

## 2. Railway
1. Crie um projeto em https://railway.com, escolha **Deploy from GitHub repo** e selecione `conflui`.
2. O Dockerfile na raiz será usado para compilar o site e iniciar a API.
3. **Antes do deploy**, adicione um **Volume** ao serviço e configure o caminho de montagem **`/data`**. Sem isso o histórico é perdido.
4. Em **Variables**, adicione:
   - `DATABASE_URL=sqlite:////data/conflui.db`
   - `DATA_MODE=simulator`
   - `COOKIE_SECURE=true`
   - `INGEST_KEY=` seguido de uma chave secreta aleatória de pelo menos 32 caracteres (gere localmente com `python -c "import secrets;print(secrets.token_urlsafe(32))"`).
   - `ADMIN_EMAIL=` seu e-mail para login.
   - `ADMIN_PASSWORD=` senha nova, forte, com pelo menos 12 caracteres (não use a senha anterior).
5. Faça deploy e aguarde a API ficar operacional. Em **Networking**, habilite **Generate Domain**.
6. Copie o domínio HTTPS gerado, como `https://conflui-production.up.railway.app` (exemplo, não é seu endereço real).
7. Adicione **CORS_ORIGINS** como array JSON **com seu domínio real**, por exemplo `[`"https://conflui-production.up.railway.app"`]` (sem barra no final). Redeploy.
8. Abra seu domínio. Confira login, mapa, histórico, eventos e assistente. A API de saúde fica em `https://SEU_DOMINIO/api/health` e a documentação em `https://SEU_DOMINIO/api/docs`.

## 3. Cuidados
- `ADMIN_EMAIL` e `ADMIN_PASSWORD` são usados para criar a **primeira conta administrativa** apenas se o banco estiver vazio. Não redefinem a conta a cada deploy.
- O banco antigo do ZIP **não é publicado**. Esta implantação cria banco e histórico de demonstração novos. Para transferir registros existentes, será necessária uma migração separada e segura.
- O simulador gera dados **sintéticos**, não dados reais de câmeras.
- O Assistente IA é o protótipo por regras já presente no projeto, **não** um LLM conectado.
- Railway não é necessariamente grátis: confira o custo, créditos e limites atuais na plataforma. SQLite em volume requer **uma instância** de serviço; não escale horizontalmente sem migrar a persistência.
- Mantenha este repositório privado, pois se trata de ferramenta administrativa com dados de demonstração e código de acesso restrito.
- Para validar o build local da imagem use `docker build -t conflui .` (Docker instalado). O deploy real só pode ser verificado após vincular o GitHub e configurar o Railway.
