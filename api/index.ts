// Ponto de entrada da API na Vercel.
//
// A Vercel trata qualquer arquivo dentro de /api como uma Function
// serverless. Aqui apenas reaproveitamos o app Express já existente em
// artifacts/api-server/src/app.ts (sem o app.listen(), que não faz sentido
// em ambiente serverless — cada requisição "acorda" a função).
//
// O rewrite configurado em vercel.json ("/api/(.*)" -> "/api") garante que
// toda requisição para /api/* chegue aqui, preservando o path original
// (ex: /api/children), que é exatamente o que o Express espera, já que o
// router interno é montado em app.use("/api", router).
import "../artifacts/api-server/src/env-loader";
import app from "../artifacts/api-server/src/app";

export default app;
