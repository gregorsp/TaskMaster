import { initDb, saveDb, closeDb } from "./client.js";
import { runMigration } from "./migrations.js";

async function run() {
  await initDb();
  runMigration();
  saveDb();
  closeDb();
  console.log("Migration complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
