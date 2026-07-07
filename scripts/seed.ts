import { client, db } from "../src/db";
import { seedTutor } from "../src/lib/seed";

async function main() {
  const tutor = await seedTutor(db, {
    email: process.env.TUTOR_EMAIL ?? "",
    password: process.env.TUTOR_PASSWORD ?? "",
    name: process.env.TUTOR_NAME,
  });

  console.log(`Seeded tutor ${tutor.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    client.close();
  });
