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
        sql,
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

async function getCoreTableState() {
  const found = [];
  const missing = [];

  for (const tableName of CORE_TABLES) {
    if (await tableExists(tableName)) found.push(tableName);
    else missing.push(tableName);
  }

  return {
    found,
    missing,
    hasAll: missing.length === 0,
    hasAny: found.length > 0
  };
}

async function ensureSchemaMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      execution_mode TEXT NOT NULL DEFAULT 'applied'
        CHECK (execution_mode IN ('applied', 'baseline')),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await query(
    `SELECT filename, checksum, execution_mode, applied_at
     FROM schema_migrations
     ORDER BY filename`
  );
  return result.rows;
}

async function recordMigration(filename, checksum, executionMode) {
  await query(
    `INSERT INTO schema_migrations (filename, checksum, execution_mode)
     VALUES ($1, $2, $3)`,
    [filename, checksum, executionMode]
  );
}

async function baselineExistingDatabase(migrations) {
  process.stdout.write("Mevcut cekirdek tablolar bulundu. Eski migration dosyalari tekrar calistirilmadan baseline olarak isaretlenecek.\n");

  for (const migration of migrations) {
    await recordMigration(migration.filename, migration.checksum, "baseline");
    process.stdout.write(`Baseline kaydi eklendi: ${migration.filename}\n`);
  }
}

function assertNoChecksumMismatch(migrations, appliedRows) {
  const currentByFilename = new Map(migrations.map((migration) => [migration.filename, migration]));

  for (const row of appliedRows) {
    const current = currentByFilename.get(row.filename);
    if (!current) {
      process.stdout.write(`Uyari: Veritabaninda kayitli ama klasorde bulunmayan migration: ${row.filename}\n`);
      continue;
    }
    if (current.checksum !== row.checksum) {
      throw new Error(
        `Checksum uyusmazligi: ${row.filename}. Bu dosya daha once farkli icerikle uygulanmis gorunuyor. Otomatik devam edilmedi.`
      );
    }
  }
}

function assertNoGapBeforeLastApplied(migrations, appliedRows) {
  const appliedFilenames = new Set(appliedRows.map((row) => row.filename));
  let lastAppliedIndex = -1;

  migrations.forEach((migration, index) => {
    if (appliedFilenames.has(migration.filename)) {
      lastAppliedIndex = Math.max(lastAppliedIndex, index);
    }
  });

  const missingBeforeLastApplied = migrations
    .slice(0, Math.max(lastAppliedIndex, 0))
    .filter((migration) => !appliedFilenames.has(migration.filename));

  if (missingBeforeLastApplied.length) {
    throw new Error(
      `Migration takip kaydinda aralik var: ${missingBeforeLastApplied.map((migration) => migration.filename).join(", ")}. Riskli otomatik islem yapilmadi.`
    );
  }
}

async function main() {
  process.stdout.write(`Env dosyalari: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "bulunamadi"}\n`);

  const migrations = await loadMigrationFiles();
  if (!migrations.length) {
    process.stdout.write("Calistirilacak migration dosyasi bulunamadi.\n");
    return;
  }

  await ensureSchemaMigrationsTable();

  const appliedRows = await getAppliedMigrations();
  const coreState = await getCoreTableState();

  if (appliedRows.length === 0) {
    if (coreState.hasAll) {
      await baselineExistingDatabase(migrations);
      process.stdout.write("Baseline islemi tamamlandi. Migration dosyalari tekrar calistirilmadi.\n");
      return;
    }

    if (coreState.hasAny) {
      throw new Error(
        `Kismi veritabani durumu tespit edildi. Bulunan tablolar: ${coreState.found.join(", ") || "yok"}. Eksik tablolar: ${coreState.missing.join(", ") || "yok"}. Otomatik migration durduruldu.`
      );
    }
  }

  assertNoChecksumMismatch(migrations, appliedRows);
  assertNoGapBeforeLastApplied(migrations, appliedRows);

  const appliedFilenames = new Set(appliedRows.map((row) => row.filename));
  let appliedCount = 0;

  for (const migration of migrations) {
    if (appliedFilenames.has(migration.filename)) {
      process.stdout.write(`Atlandi, daha once uygulanmis: ${migration.filename}\n`);
      continue;
    }

    process.stdout.write(`Migration calisiyor: ${migration.filename}\n`);
    await query(migration.sql);
    await recordMigration(migration.filename, migration.checksum, "applied");
    process.stdout.write(`Migration kaydedildi: ${migration.filename}\n`);
    appliedCount += 1;
  }

  process.stdout.write(appliedCount ? "Yeni migrationlar tamamlandi.\n" : "Calistirilacak yeni migration yok.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
