// Cria o usuário administrador inicial no banco de dados.
//
// Uso:
//   DATABASE_URL="postgres://..." pnpm --filter @workspace/scripts exec tsx src/seed-admin.ts
//
// Ou, de dentro da pasta scripts/:
//   DATABASE_URL="postgres://..." npx tsx src/seed-admin.ts
//
// Pode rodar quantas vezes quiser: se o e-mail já existir, o script apenas avisa
// e não duplica o usuário.
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@ebi.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const name = process.env.SEED_ADMIN_NAME ?? "Administrador";

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (existing) {
    console.log(`Usuário "${email}" já existe. Nada a fazer.`);
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);

  await db.insert(usersTable).values({
    name,
    email,
    password: hashed,
    role: "admin",
  });

  console.log(`Usuário admin criado: ${email} / ${password}`);
  console.log("IMPORTANTE: troque essa senha assim que possível.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
