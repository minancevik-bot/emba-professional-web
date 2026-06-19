const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { loadEnv } = require("../src/env");
const loadedEnvFiles = loadEnv();
const { query, closePool } = require("../src/db");

const CORE_TABLES = [
  "users",
  "students",
  "payments",
  "attendance_records",
  "app_settings"
];

function checksumSql(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function loadMigrationFiles() {
  const migrationsDir = path.join(__dirname, "..", "migrations");
  const filenames = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      return {
        filename,
        checksum: checksumSql(sql)
      };
    })
  );
}

async function tableExists(tableName) {
  const result = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS found`,
    [tableName]
  );
  return result.rows[0]?.found === true;
}

async function getSchemaMigrationsColumns() {
  const result = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ORDER BY ordinal_position`
  );
  return result.rows.map((row) => row.column_name);
}

async function getAppliedMigrations() {
  const result = await query(
    `SELECT filename, checksum, execution_mode, applied_at
     FROM schema_migrations
     ORDER BY filename`
  );
  return result.rows;
}

async function getCoreTableState() {
  const rows = [];
  for (const tableName of CORE_TABLES) {
    rows.push({
      tableName,
      found: await tableExists(tableName)
    });
  }
  return rows;
}

function printSection(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function printMigrationComparison(migrations, appliedRows) {
  const appliedByFilename = new Map(appliedRows.map((row) => [row.filename, row]));

  for (const migration of migrations) {
    const applied = appliedByFilename.get(migration.filename);
    if (!applied) {
      process.stdout.write(`${migration.filename}: TAKIP KAYDI YOK\n`);
      continue;
    }

    const checksumStatus = applied.checksum === migration.checksum ? "checksum OK" : "CHECKSUM UYUSMAZ";
    process.stdout.write(`${migration.filename}: ${applied.execution_mode}, ${checksumStatus}, applied_at=${applied.applied_at.toISOString()}\n`);
  }

  for (const applied of appliedRows) {
    if (!migrations.some((migration) => migration.filename === applied.filename)) {
      process.stdout.write(`${applied.filename}: VERITABANINDA KAYITLI, DOSYA YOK\n`);
    }
  }
}

function printInterpretation(schemaTableExists, coreRows, appliedRows) {
  const foundCore = coreRows.filter((row) => row.found).map((row) => row.tableName);
  const missingCore = coreRows.filter((row) => !row.found).map((row) => row.tableName);

  printSection("Durum yorumu");
  if (!schemaTableExists && foundCore.length === coreRows.length) {
    process.stdout.write("schema_migrations yok, cekirdek tablolar var. Sonraki npm run migrate komutu mevcut migrationlari baseline olarak isaretlemeli.\n");
    return;
  }

  if (!schemaTableExists && foundCore.length === 0) {
    process.stdout.write("schema_migrations yok, cekirdek tablolar yok. Veritabani bos gorunuyor; migrate komutu migrationlari normal calistirir.\n");
    return;
  }

  if (!schemaTableExists && foundCore.length > 0 && missingCore.length > 0) {
    process.stdout.write(`Kismi tablo durumu var. Bulunan: ${foundCore.join(", ")}. Eksik: ${missingCore.join(", ")}. Otomatik migration riskli.\n`);
    return;
  }

  if (schemaTableExists && appliedRows.length === 0 && foundCore.length === coreRows.length) {
    process.stdout.write("schema_migrations var ama bos; cekirdek tablolar mevcut. Sonraki migrate komutu baseline kaydi olusturur.\n");
    return;
  }

  if (schemaTableExists) {
    process.stdout.write("schema_migrations mevcut. Migrate komutu checksum uyusmazligi yoksa sadece takipte olmayan yeni migrationlari calistirir.\n");
  }
}

async function main() {
  process.stdout.write(`Env dosyalari: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "bulunamadi"}\n`);

  const migrations = await loadMigrationFiles();
  const schemaTableExists = await tableExists("schema_migrations");
  const coreRows = await getCoreTableState();
  let appliedRows = [];

  printSection("Migration dosyalari");
  if (!migrations.length) process.stdout.write("Migration dosyasi bulunamadi.\n");
  for (const migration of migrations) {
    process.stdout.write(`${migration.filename}: ${migration.checksum}\n`);
  }

  printSection("schema_migrations");
  process.stdout.write(`Var mi? ${schemaTableExists ? "EVET" : "HAYIR"}\n`);
  if (schemaTableExists) {
    const columns = await getSchemaMigrationsColumns();
    process.stdout.write(`Kolonlar: ${columns.join(", ")}\n`);
    appliedRows = await getAppliedMigrations();
    process.stdout.write(`Kayit sayisi: ${appliedRows.length}\n`);
  }

  printSection("Cekirdek tablo kontrolu");
  for (const row of coreRows) {
    process.stdout.write(`${row.tableName}: ${row.found ? "VAR" : "YOK"}\n`);
  }

  printSection("Migration uyumu");
  if (!schemaTableExists) {
    process.stdout.write("Takip tablosu olmadigi icin dosya/kayit karsilastirmasi yapilmadi.\n");
  } else {
    printMigrationComparison(migrations, appliedRows);
  }

  printInterpretation(schemaTableExists, coreRows, appliedRows);
}

main()
  .catch((error) => {
    console.error("\nMigration status kontrolu basarisiz oldu:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
