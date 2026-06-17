const fs = require("fs/promises");
const path = require("path");
const { loadEnv } = require("../src/env");
const loadedEnvFiles = loadEnv();
const { query, closePool } = require("../src/db");

async function main() {
  process.stdout.write(`Env dosyalari: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "bulunamadi"}\n`);
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`Migrasyon calisiyor: ${file}\n`);
    await query(sql);
  }

  process.stdout.write("Tum migrasyonlar tamamlandi.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
