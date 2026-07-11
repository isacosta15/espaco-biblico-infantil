# Deploy do Espaço Bíblico Infantil na Vercel

Este projeto já vem adaptado para rodar na Vercel: frontend (React + Vite,
com PWA/offline) publicado como site estático, e a API (Express) publicada
como uma Function serverless em `/api`.

## O que foi ajustado em relação ao projeto original

- `artifacts/espaco-biblico/vite.config.ts`: as variáveis `PORT` e
  `BASE_PATH` (usadas só no Replit) agora têm valores padrão, já que a
  Vercel não as define durante o build.
- `api/index.ts` (novo): reaproveita o app Express existente
  (`artifacts/api-server/src/app.ts`) como uma Function serverless — nenhuma
  rota foi reescrita.
- `vercel.json` (novo): ensina a Vercel a instalar o monorepo pnpm, buildar
  só o pacote do frontend, e redirecionar `/api/*` para a Function e o
  restante para `index.html` (necessário para o roteamento client-side do
  Wouter funcionar em qualquer URL).
- `scripts/src/seed-admin.ts` (novo): cria o usuário administrador inicial no
  banco (o projeto original não tinha um script de seed — o usuário
  admin@ebi.com foi criado manualmente no ambiente Replit).

Nada do código de negócio (rotas, schema do banco, telas, PWA) foi alterado.

## Passo 1 — Banco de dados Postgres

O projeto já usa PostgreSQL + Drizzle ORM (não é MySQL), o que combina bem
com a Vercel. Escolha uma opção:

- **Neon** (recomendado, tem integração nativa com a Vercel):
  1. Crie uma conta em https://neon.tech
  2. Crie um projeto/banco
  3. Copie a "Connection string" (formato `postgres://...`)
- **Vercel Postgres / Supabase**: qualquer um funciona, só precisa da
  connection string no formato acima.

## Passo 2 — Subir o repositório para o GitHub

Se ainda não estiver em um repositório Git, crie um repositório no GitHub e
suba este projeto (pasta inteira, incluindo `vercel.json` e a pasta `api/`).

## Passo 3 — Importar o projeto na Vercel

1. Acesse https://vercel.com/new e importe o repositório.
2. Em "Root Directory", deixe a **raiz do repositório** (não aponte para
   `artifacts/espaco-biblico` — o build precisa enxergar o monorepo inteiro).
3. Em "Environment Variables", adicione:
   - `DATABASE_URL` — a connection string do Passo 1
   - `JWT_SECRET` — qualquer string aleatória longa (ex: gerada com
     `openssl rand -base64 48`)
   - `NODE_ENV` = `production`
4. Clique em Deploy. O `vercel.json` já define o comando de build e a pasta
   de saída, então não é necessário mexer nas configurações de Framework.

## Passo 4 — Criar as tabelas no banco

Antes do primeiro login, as tabelas precisam existir no banco. Rode, na sua
máquina local (com Node e pnpm instalados), apontando para o mesmo
`DATABASE_URL` configurado na Vercel:

```bash
pnpm install
DATABASE_URL="postgres://sua-connection-string" pnpm --filter @workspace/db run push
```

## Passo 5 — Criar o usuário administrador

Ainda na sua máquina local, com a mesma `DATABASE_URL`:

```bash
DATABASE_URL="postgres://sua-connection-string" pnpm --filter @workspace/scripts run seed-admin
```

Por padrão isso cria o login `admin@ebi.com` / `admin123`. Para usar outro
e-mail/senha, defina as variáveis `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`
antes de rodar o comando (veja `.env.example`).

**Troque essa senha assim que possível** — hoje o sistema ainda não tem uma
tela de "alterar senha"; isso pode ser um próximo passo.

## Passo 6 — Testar

Acesse a URL que a Vercel gerou, faça login com o usuário criado no Passo 5,
e confira: dashboard, presença, cadastro de crianças, relatórios e
congregações.

## Sobre o funcionamento offline (PWA + IndexedDB)

O app tem duas camadas de suporte offline:

1. **Service Worker** (`vite-plugin-pwa`): faz cache dos arquivos estáticos
   (HTML/CSS/JS), permitindo abrir o app mesmo sem internet.
2. **Espelho local em IndexedDB** (`src/lib/offline/`): guarda uma cópia dos
   dados (crianças, congregações, presenças, relatórios) no aparelho, e
   intercepta toda chamada à API. Isso é o que faz o app funcionar de
   verdade offline, não só abrir a tela.

Com isso, **funciona 100% offline**:
- Buscar/filtrar crianças, ver perfil, histórico, dashboard e relatórios
  (usando os últimos dados que já passaram por este aparelho com internet).
- Marcar presença — inclusive impedindo presença duplicada no mesmo dia,
  igual ao comportamento online.
- Cadastro rápido e cadastro completo de crianças.
- Criar/editar congregações.

Tudo isso fica guardado em uma fila local e é **enviado automaticamente
para o servidor assim que a internet voltar** (por evento de conexão e
também por uma checagem a cada 15 segundos, para redes instáveis). Um
indicador na barra lateral mostra quando está offline, quantas ações estão
pendentes, e quando está sincronizando.

**Limitações a conhecer:**
- "Crianças com mais faltas" e "frequência" individual são cálculos que
  dependem de todo o histórico no servidor; offline, eles mostram o último
  valor visto (podem ficar desatualizados até sincronizar).
- O login em si sempre exige internet na primeira vez em cada aparelho
  (depois disso, o token fica salvo e as telas funcionam offline
  normalmente).
- Se dois auxiliares marcarem presença da mesma criança offline em
  aparelhos diferentes, o servidor aceita a primeira sincronização e
  descarta a segunda como duplicada — não gera erro, só não duplica.

## Rodando localmente para testar antes de publicar

```bash
pnpm install
cp .env.example .env   # preencha DATABASE_URL e JWT_SECRET
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed-admin
pnpm --filter @workspace/api-server run dev    # API em outra aba/terminal
pnpm --filter @workspace/espaco-biblico run dev
```
