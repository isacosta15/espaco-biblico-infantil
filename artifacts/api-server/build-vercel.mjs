// Empacota artifacts/api-server/src/app.ts (o app Express, sem o app.listen())
// em um ÚNICO arquivo JavaScript já pronto, em api/index.mjs, na raiz do
// repositório. Isso existe porque a Vercel, ao compilar um arquivo .ts
// diretamente dentro de /api, aplica as regras de módulo do tsconfig do
// projeto (pensadas para rodar com tsx/node, não para o bundler da Vercel),
// o que gera erros de tipo que não têm relação com bugs reais no código.
//
// Rodando este script ANTES de cada `git push` que mude algo no backend,
// a função da Vercel passa a usar só JavaScript puro já compilado — muito
// mais confiável.
//
// Uso (dentro da pasta artifacts/api-server):
//   pnpm run build:vercel
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(artifactDir, "../..");
const outfile = path.resolve(repoRoot, "api/index.mjs");

async function buildAll() {
  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/app.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile,
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "fsevents",
      "pg-native",
      "nodemailer",
    ],
    sourcemap: false,
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  });

  console.log(`\nArquivo gerado: ${path.relative(repoRoot, outfile)}`);
  console.log("Lembre de dar `git add`, `git commit` e `git push` para publicar essa versão.");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});