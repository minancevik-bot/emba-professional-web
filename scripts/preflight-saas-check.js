const { query, closePool, getConnectionInfo } = require("../src/db");

const SCHEMA = "public";
const REQUIRED_TABLES = [
  "clubs",
  "branches",
  "users",
  "students",
  "student_lessons",
  "attendance_records",
  "payments",
  "audit_logs",
  "backups",
  "app_settings"
];

const TENANT_TABLES = [
  "users",
  "students",
  "student_lessons",
  "attendance_records",
  "payments",
  "audit_logs",
  "backups",
  "app_settings"
];

const BRANCH_TABLES = [
  "students",
  "student_lessons",
  "attendance_records",
  "payments"
];

const REFERENCE_COUNTS = {
  students: 102,
  payments: 676,
  attendance_records: 3
};

const MIGRATION_TRACKING_TABLES = [
  "schema_migrations",
  "migrations",
  "knex_migrations"
];

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Gecersiz tanimlayici: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

async function getTargetInfo() {
  const result = await query(
    "SELECT current_database() AS database_name, current_user AS database_user, current_schema() AS schema_name"
  );
  return result.rows[0];
}

async function tableExists(tableName) {
  const result = await query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS found",
    [SCHEMA, tableName]
  );
  return result.rows[0]?.found === true;
}

async function getTableCount(tableName) {
  const result = await query(
    `SELECT COUNT(*)::BIGINT AS row_count FROM ${quoteIdentifier(SCHEMA)}.${quoteIdentifier(tableName)}`
  );
  return result.rows[0]?.row_count || "0";
}

async function getColumns(tableName) {
  const result = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [SCHEMA, tableName]
  );
  return result.rows.map((row) => row.column_name);
}

async function getNullCount(tableName, columnName) {
  if (!(await tableExists(tableName))) return null;
  const columns = await getColumns(tableName);
  if (!columns.includes(columnName)) return null;
  const result = await query(
    `SELECT COUNT(*)::BIGINT AS null_count
     FROM ${quoteIdentifier(SCHEMA)}.${quoteIdentifier(tableName)}
     WHERE ${quoteIdentifier(columnName)} IS NULL`
  );
  return result.rows[0]?.null_count || "0";
}

async function getEmbaClub() {
  if (!(await tableExists("clubs"))) return null;
  const result = await query(
    "SELECT id, name, slug, status, plan FROM clubs WHERE slug = $1",
    ["emba"]
  );
  return result.rows[0] || null;
}

async function getDefaultBranch(embaClubId) {
  if (!embaClubId || !(await tableExists("branches"))) return null;
  const result = await query(
    `SELECT id, club_id, name, type, active
     FROM branches
     WHERE club_id = $1 AND name = $2`,
    [embaClubId, "Ana Şube / Ana Salon"]
  );
  return result.rows[0] || null;
}

async function findExistingTables(tableNames) {
  const found = [];
  for (const tableName of tableNames) {
    if (await tableExists(tableName)) found.push(tableName);
  }
  return found;
}

function printSection(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function printList(items, emptyText) {
  if (!items.length) {
    process.stdout.write(`- ${emptyText}\n`);
    return;
  }
  for (const item of items) process.stdout.write(`- ${item}\n`);
}

async function main() {
  const connectionInfo = getConnectionInfo();
  const tableResults = [];
  const missingTables = [];
  const missingClubId = [];
  const missingBranchOrHall = [];

  printSection("Baglanti");
  const targetInfo = await getTargetInfo();
  process.stdout.write("Baglanti basarili mi? EVET\n");
  process.stdout.write(`PostgreSQL hedefi: database=${targetInfo.database_name}, user=${targetInfo.database_user}, schema=${targetInfo.schema_name}\n`);
  process.stdout.write(`DATABASE_URL: ${connectionInfo.databaseUrl}\n`);
  process.stdout.write(`SSL aktif mi? ${connectionInfo.sslEnabled ? "EVET" : "HAYIR"}\n`);
  process.stdout.write(`Query timeout ms: ${connectionInfo.queryTimeoutMs}\n`);
  process.stdout.write(`Statement timeout ms: ${connectionInfo.statementTimeoutMs}\n`);

  printSection("Migration takip kontrolu");
  const trackingTables = await findExistingTables(MIGRATION_TRACKING_TABLES);
  process.stdout.write(`Takip tablosu var mi? ${trackingTables.length ? "EVET" : "HAYIR"}\n`);
  printList(trackingTables, "schema_migrations benzeri tablo bulunamadi");

  printSection("Tablolar ve kayit sayilari");
  for (const tableName of REQUIRED_TABLES) {
    const found = await tableExists(tableName);
    if (!found) {
      missingTables.push(tableName);
      process.stdout.write(`${tableName}: BULUNAMADI\n`);
      continue;
    }

    const [rowCount, columns] = await Promise.all([
      getTableCount(tableName),
      getColumns(tableName)
    ]);
    const hasClubId = columns.includes("club_id");
    const hasBranchId = columns.includes("branch_id");
    const hasHallId = columns.includes("hall_id");

    if (TENANT_TABLES.includes(tableName) && !hasClubId) missingClubId.push(tableName);
    if (BRANCH_TABLES.includes(tableName) && !hasBranchId && !hasHallId) missingBranchOrHall.push(tableName);

    tableResults.push({
      tableName,
      rowCount,
      columns,
      hasClubId,
      hasBranchId,
      hasHallId
    });

    process.stdout.write(`${tableName}: BULUNDU, ${rowCount} kayit\n`);
  }

  printSection("SaaS temel kontrolu");
  const embaClub = await getEmbaClub();
  const defaultBranch = await getDefaultBranch(embaClub?.id);
  process.stdout.write(`clubs tablosu var mi? ${await tableExists("clubs") ? "EVET" : "HAYIR"}\n`);
  process.stdout.write(`branches tablosu var mi? ${await tableExists("branches") ? "EVET" : "HAYIR"}\n`);
  process.stdout.write(`EMBA kulubu var mi? ${embaClub ? "EVET" : "HAYIR"}\n`);
  if (embaClub) {
    process.stdout.write(`  EMBA: id=${embaClub.id}, status=${embaClub.status}, plan=${embaClub.plan}\n`);
  }
  process.stdout.write(`EMBA default branch var mi? ${defaultBranch ? "EVET" : "HAYIR"}\n`);
  if (defaultBranch) {
    process.stdout.write(`  Branch: id=${defaultBranch.id}, name=${defaultBranch.name}, type=${defaultBranch.type}, active=${defaultBranch.active}\n`);
  }

  printSection("Kolon kontrolu");
  for (const result of tableResults) {
    process.stdout.write(
      `${result.tableName}: club_id=${result.hasClubId ? "VAR" : "YOK"}, branch_id=${result.hasBranchId ? "VAR" : "YOK"}, hall_id=${result.hasHallId ? "VAR" : "YOK"}\n`
    );
    process.stdout.write(`  kolonlar: ${result.columns.join(", ")}\n`);
  }

  printSection("Eksik tablo kontrolu");
  printList(missingTables, "Zorunlu tablolarin tamami bulundu");

  printSection("club_id olmayan tablolar");
  printList(missingClubId, "Tum hedef tablolarda club_id var");

  printSection("branch_id veya hall_id olmayan tablolar");
  printList(missingBranchOrHall, "Tum hedef tablolarda branch_id veya hall_id var");

  printSection("club_id NULL kontrolu");
  for (const tableName of TENANT_TABLES) {
    const nullCount = await getNullCount(tableName, "club_id");
    process.stdout.write(`${tableName}: ${nullCount === null ? "club_id kolonu yok veya tablo yok" : `${nullCount} NULL kayit`}\n`);
  }

  printSection("branch_id NULL kontrolu");
  for (const tableName of BRANCH_TABLES) {
    const nullCount = await getNullCount(tableName, "branch_id");
    process.stdout.write(`${tableName}: ${nullCount === null ? "branch_id kolonu yok veya tablo yok" : `${nullCount} NULL kayit`}\n`);
  }

  printSection("Ana veri sayisi referans kontrolu");
  for (const [tableName, expectedCount] of Object.entries(REFERENCE_COUNTS)) {
    const currentCount = await getTableCount(tableName);
    const status = Number(currentCount) === expectedCount ? "UYUMLU" : "DEGISMIS";
    process.stdout.write(`${tableName}: ${currentCount} kayit, referans=${expectedCount}, durum=${status}\n`);
  }

  printSection("Multi-tenant migration oncesi riskler");
  printList([
    trackingTables.length
      ? "Migration takip tablosu bulundu; yine de uygulama komutunun bunu kullanip kullanmadigi ayrica incelenmeli"
      : "Migration takip tablosu bulunamadi; ayni dosyalar tekrar calistirilabilir",
    missingClubId.length
      ? "club_id olmayan tablolar tenant izolasyonu icin kritik"
      : "club_id eksigi gorunmuyor",
    "app_settings su anda global yapi gibi duruyor; kulup bazli ayar modeline ayrilmali",
    "student_lessons ve attendance_records ayni anda kulup ve ders grubu baglamina alinmali",
    "payments tablosu finansal veri tasidigi icin kulup filtresi en siki kontrol edilmesi gereken alanlardan biri"
  ], "Belirgin risk bulunamadi");

  printSection("EMBA varsayilan kulube baglama oncesi dikkat");
  printList([
    "Tam veritabani yedegi alinmali",
    "EMBA Spor Kulubu icin slug=emba ve status=active olacak tek varsayilan kulup kaydi planlanmali",
    "Mevcut satir sayilari migration oncesi ve sonrasi karsilastirilmali",
    "Ogrenci, odeme ve yoklama kayitlari ayni kulup kimligine baglanmali",
    "Kolon zorunlulugu ve iliski kurallari ancak tum mevcut satirlar eslendikten sonra devreye alinmali"
  ], "Ek dikkat maddesi yok");
}

main()
  .catch((error) => {
    console.error("\nPreflight kontrolu basarisiz oldu:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
