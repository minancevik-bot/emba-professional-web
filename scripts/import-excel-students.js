const fs = require("fs");
const path = require("path");
const readXlsxFile = require("read-excel-file/node");
const { loadEnv } = require("../src/env");

loadEnv();

const { pool, closePool, getConnectionInfo } = require("../src/db");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_FILE = path.join(PROJECT_ROOT, "import", "ogrenci-verileri.xlsx");
const TARGET_SHEET_KEY = "ogrenci kayit";
const BACKUP_TABLES = [
  "students",
  "student_lessons",
  "student_groups",
  "groups",
  "attendance_sessions",
  "attendance_records",
  "student_notes",
  "payments"
];

const DAY_NAMES = {
  pazartesi: "Pazartesi",
  sali: "Sal\u0131",
  carsamba: "\u00c7ar\u015famba",
  persembe: "Per\u015fembe",
  cuma: "Cuma",
  cumartesi: "Cumartesi",
  pazar: "Pazar"
};

const MONTHS = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12
};

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    club: "emba",
    backup: false,
    dryRun: false,
    import: false,
    confirm: false,
    expectStudents: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file") args.file = path.resolve(argv[++index] || "");
    else if (arg === "--club") args.club = String(argv[++index] || "").trim();
    else if (arg === "--backup") args.backup = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--import") args.import = true;
    else if (arg === "--confirm") args.confirm = true;
    else if (arg === "--expect-students") args.expectStudents = Number(argv[++index]);
    else if (arg.endsWith(".xlsx")) args.file = path.resolve(arg);
  }

  return args;
}

function text(value) {
  return String(value ?? "").trim();
}

function compactText(value) {
  return text(value).replace(/\s+/g, " ");
}

function normalizeForMatch(value) {
  return text(value)
    .replace(/\u0130/g, "I")
    .replace(/\u0131/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return normalizeForMatch(value).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function validStudentName(value) {
  const name = compactText(value);
  return name.length >= 3 && /[A-Za-z\u00c7\u011e\u0130\u00d6\u015e\u00dc\u00e7\u011f\u0131\u00f6\u015f\u00fc]/.test(name);
}

function normalizeStatus(value) {
  const normalized = normalizeForMatch(value);
  if (normalized.includes("bekleyen")) return "Bekleyen";
  if (normalized.includes("pasif") || normalized.includes("ara veren") || normalized.includes("ara")) return "Pasif";
  return "Aktif";
}

function normalizeLevel(value) {
  const normalized = normalizeForMatch(value);
  if (normalized.includes("ileri")) return "\u0130leri";
  if (normalized.includes("orta")) return "Orta";
  if (normalized.includes("baslangic")) return "Ba\u015flang\u0131\u00e7";
  return compactText(value) || "Ba\u015flang\u0131\u00e7";
}

function normalizePackage(value, feeHint) {
  const normalized = normalizeForMatch(value);
  if (normalized.includes("ozel") || normalized.includes("bireysel")) {
    return { code: "OZEL-DERS", name: "\u00d6zel Ders", fee: Number(feeHint || 20000) };
  }
  if (normalized.includes("spor")) {
    return { code: "YUZME-SPOR", name: "Y\u00fczme + Spor", fee: Number(feeHint || 8500) };
  }
  return { code: "GRUP-YUZME", name: "Grup Y\u00fczme", fee: Number(feeHint || 6000) };
}

function normalizeDay(value) {
  const key = normalizeForMatch(value);
  return DAY_NAMES[key] || null;
}

function normalizeClock(value) {
  const raw = text(value).replace(/\./g, ":");
  const match = raw.match(/(\d{1,2}):(\d{1,2})(?::\d{1,2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseSlot(value) {
  const raw = compactText(value);
  if (!raw) return null;
  const [rawDay, rawRange = ""] = raw.split("|").map((part) => compactText(part));
  const day = normalizeDay(rawDay);
  if (!day) return { error: `Gecersiz gun: ${raw}` };

  const [rawStart, rawEnd = ""] = rawRange.split("-").map((part) => compactText(part));
  const startTime = normalizeClock(rawStart || rawRange);
  const endTime = normalizeClock(rawEnd);
  if (!startTime) return { error: `Gecersiz saat: ${raw}` };
  return { day, startTime, endTime };
}

function parseDateCell(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dotted) {
    return `${dotted[3]}-${String(dotted[2]).padStart(2, "0")}-${String(dotted[1]).padStart(2, "0")}`;
  }
  return null;
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthPeriodFromSheetName(sheetName) {
  const normalized = normalizeForMatch(sheetName);
  const monthName = Object.keys(MONTHS).find((name) => normalized.includes(name));
  const yearMatch = normalized.match(/\b(20\d{2})\b/);
  if (!monthName || !yearMatch) return null;
  return `${yearMatch[1]}-${String(MONTHS[monthName]).padStart(2, "0")}-01`;
}

function findSheet(workbook, targetKey) {
  return workbook.find((sheet) => normalizeForMatch(sheet.sheet) === targetKey);
}

function dataRowsAfterHeader(rows, headerMatcher) {
  const headerIndex = rows.findIndex((row) => headerMatcher(row));
  if (headerIndex === -1) {
    throw new Error("Excel icinde beklenen baslik satiri bulunamadi.");
  }
  return { headerIndex, rows: rows.slice(headerIndex + 1) };
}

function parsePaymentFeeHints(workbook) {
  const feeByName = new Map();
  let paymentRows = 0;

  for (const sheet of workbook) {
    const period = monthPeriodFromSheetName(sheet.sheet);
    if (!period) continue;
    for (const row of sheet.data || []) {
      const sequence = parseNumber(row[0]);
      const fullName = compactText(row[1]);
      if (!sequence || !validStudentName(fullName)) continue;
      paymentRows += 1;
      const packageType = compactText(row[2]);
      const fee = parseNumber(row[3]);
      if (!fee && !packageType) continue;
      const key = normalizeName(fullName);
      const existing = feeByName.get(key);
      if (!existing || period >= existing.period) {
        feeByName.set(key, { period, fee, packageType });
      }
    }
  }

  return { feeByName, paymentRows };
}

function parseStudents(workbook) {
  const sheet = findSheet(workbook, TARGET_SHEET_KEY);
  if (!sheet) {
    throw new Error("Ogrenci Kayit sayfasi bulunamadi.");
  }

  const paymentHints = parsePaymentFeeHints(workbook);
  const { headerIndex, rows } = dataRowsAfterHeader(sheet.data, (row) => (
    normalizeForMatch(row[2]).includes("ogrenci adi") && normalizeForMatch(row[8]).includes("ders 1")
  ));
  const parsed = [];
  const invalidRows = [];
  const blankRows = [];
  const duplicateRows = [];
  const seenNames = new Map();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = headerIndex + index + 2;
    const hasAnyValue = row.some((value) => text(value));
    if (!hasAnyValue) {
      blankRows.push(rowNumber);
      continue;
    }

    const sequence = parseNumber(row[0]);
    const fullName = compactText(row[2]);
    if (!sequence && !fullName) {
      blankRows.push(rowNumber);
      continue;
    }
    if (!validStudentName(fullName)) {
      invalidRows.push({ rowNumber, reason: "Ogrenci adi eksik/gecersiz.", raw: row });
      continue;
    }

    const nameKey = normalizeName(fullName);
    if (seenNames.has(nameKey)) {
      duplicateRows.push({ rowNumber, fullName, firstRowNumber: seenNames.get(nameKey) });
      continue;
    }
    seenNames.set(nameKey, rowNumber);

    const rawSlots = row.slice(8, 12).map(compactText).filter(Boolean);
    const slots = [];
    const slotErrors = [];
    const slotKeys = new Set();
    for (const rawSlot of rawSlots) {
      const slot = parseSlot(rawSlot);
      if (!slot) continue;
      if (slot.error) {
        slotErrors.push(slot.error);
        continue;
      }
      const slotKey = `${slot.day}|${slot.startTime}`;
      if (slotKeys.has(slotKey)) continue;
      slotKeys.add(slotKey);
      slots.push(slot);
    }

    if (slotErrors.length) {
      invalidRows.push({ rowNumber, fullName, reason: slotErrors.join("; ") });
      continue;
    }

    const feeHint = paymentHints.feeByName.get(nameKey);
    const packageType = compactText(row[6] || feeHint?.packageType);
    const pkg = normalizePackage(packageType, feeHint?.fee);
    parsed.push({
      rowNumber,
      sequence,
      registrationDate: parseDateCell(row[1]),
      fullName,
      birthYear: parseNumber(row[3]) || null,
      ageGroup: compactText(row[4]) || null,
      level: normalizeLevel(row[5]),
      packageType,
      packageCode: pkg.code,
      packageName: pkg.name,
      monthlyFee: pkg.fee,
      status: normalizeStatus(row[7]),
      slots
    });
  }

  return {
    sheetName: sheet.sheet,
    sheetRows: sheet.data.length,
    dataRows: rows.length,
    students: parsed,
    invalidRows,
    blankRows,
    duplicateRows,
    paymentRows: paymentHints.paymentRows
  };
}

async function loadWorkbook(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel dosyasi bulunamadi: ${filePath}`);
  }
  const workbook = await readXlsxFile(filePath);
  if (!Array.isArray(workbook) || !workbook.length || !workbook[0]?.sheet) {
    throw new Error("Excel dosyasi beklenen cok sayfali formatta okunamadi.");
  }
  return workbook;
}

async function tableColumns(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

function hasTable(columnsByTable, table) {
  return columnsByTable.has(table);
}

function hasColumn(columnsByTable, table, column) {
  return columnsByTable.get(table)?.has(column) || false;
}

async function fetchClub(client, slug) {
  const { rows } = await client.query("SELECT id, name, slug FROM clubs WHERE slug = $1 LIMIT 1", [slug]);
  if (!rows[0]) throw new Error(`Kulup bulunamadi: ${slug}`);
  return rows[0];
}

async function fetchDefaultBranchId(client, clubId) {
  const { rows } = await client.query(
    "SELECT id FROM branches WHERE club_id = $1 AND active = TRUE ORDER BY id ASC LIMIT 1",
    [clubId]
  );
  return rows[0]?.id || null;
}

async function embaStudentIds(client, clubId) {
  const { rows } = await client.query("SELECT id FROM students WHERE club_id = $1 ORDER BY id ASC", [clubId]);
  return rows.map((row) => row.id);
}

async function selectRowsForBackup(client, columnsByTable, table, clubId, studentIds) {
  if (!hasTable(columnsByTable, table)) return { rows: [], skipped: "table_missing" };
  if (table === "students") {
    const result = await client.query("SELECT * FROM students WHERE club_id = $1 ORDER BY id ASC", [clubId]);
    return { rows: result.rows };
  }
  if (hasColumn(columnsByTable, table, "student_id")) {
    const result = await client.query(`SELECT * FROM ${table} WHERE student_id = ANY($1::bigint[]) ORDER BY id ASC`, [studentIds]);
    return { rows: result.rows };
  }
  if (hasColumn(columnsByTable, table, "club_id")) {
    const result = await client.query(`SELECT * FROM ${table} WHERE club_id = $1 ORDER BY id ASC`, [clubId]);
    return { rows: result.rows };
  }
  return { rows: [], skipped: "no_safe_filter" };
}

function backupDirName() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}-before-excel-import`;
}

async function backupTables(client, columnsByTable, club, studentIds) {
  const directory = path.join(PROJECT_ROOT, "backups", backupDirName());
  fs.mkdirSync(directory, { recursive: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    club,
    database: getConnectionInfo().databaseUrl,
    tables: {}
  };

  for (const table of BACKUP_TABLES) {
    const { rows, skipped } = await selectRowsForBackup(client, columnsByTable, table, club.id, studentIds);
    manifest.tables[table] = { rowCount: rows.length, skipped: skipped || null };
    if (!skipped) {
      fs.writeFileSync(
        path.join(directory, `${table}.json`),
        JSON.stringify({ table, rowCount: rows.length, rows }, null, 2)
      );
    }
  }

  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { directory, manifest };
}

async function deletionPlan(client, columnsByTable, clubId, studentIds) {
  const plan = {};
  for (const table of BACKUP_TABLES) {
    if (!hasTable(columnsByTable, table)) {
      plan[table] = { count: 0, action: "skip", reason: "table_missing" };
      continue;
    }
    if (table === "students") {
      const result = await client.query("SELECT COUNT(*)::int AS count FROM students WHERE club_id = $1", [clubId]);
      plan[table] = { count: Number(result.rows[0].count || 0), action: "delete_by_club" };
      continue;
    }
    if (hasColumn(columnsByTable, table, "student_id")) {
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE student_id = ANY($1::bigint[])`, [studentIds]);
      plan[table] = { count: Number(result.rows[0].count || 0), action: "delete_by_student" };
      continue;
    }
    if (["groups", "attendance_sessions"].includes(table)) {
      plan[table] = { count: 0, action: "skip", reason: "no_direct_student_relation" };
      continue;
    }
    if (hasColumn(columnsByTable, table, "club_id")) {
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE club_id = $1`, [clubId]);
      plan[table] = { count: Number(result.rows[0].count || 0), action: "delete_by_club" };
      continue;
    }
    plan[table] = { count: 0, action: "skip", reason: "no_safe_filter" };
  }
  return plan;
}

function distribution(students) {
  const byDayTime = {};
  const byStatus = {};
  const byLevel = {};
  for (const student of students) {
    byStatus[student.status] = (byStatus[student.status] || 0) + 1;
    byLevel[student.level] = (byLevel[student.level] || 0) + 1;
    for (const slot of student.slots) {
      const key = `${slot.day} ${slot.startTime}${slot.endTime ? `-${slot.endTime}` : ""}`;
      byDayTime[key] = (byDayTime[key] || 0) + 1;
    }
  }
  return { byDayTime, byStatus, byLevel };
}

function buildDryRunReport(parsed, deletePlan) {
  const lessonsToCreate = parsed.students.reduce((total, student) => total + student.slots.length, 0);
  return {
    sheetName: parsed.sheetName,
    excelSheetRows: parsed.sheetRows,
    excelDataRows: parsed.dataRows,
    importableStudents: parsed.students.length,
    invalidRows: parsed.invalidRows,
    skippedBlankRows: parsed.blankRows.length,
    duplicateRows: parsed.duplicateRows,
    paymentRowsReadForFeeHints: parsed.paymentRows,
    deletePlan,
    createPlan: {
      students: parsed.students.length,
      studentLessons: lessonsToCreate,
      payments: 0
    },
    distribution: distribution(parsed.students)
  };
}

function assertDryRunLooksSafe(report, args) {
  if (args.expectStudents && report.importableStudents !== args.expectStudents) {
    throw new Error(`Beklenen ogrenci sayisi ${args.expectStudents}, Excel import edilebilir sayi ${report.importableStudents}. Import durduruldu.`);
  }
  if (report.importableStudents < 1) {
    throw new Error("Import edilebilir ogrenci bulunamadi. Import durduruldu.");
  }
  if (report.invalidRows.length) {
    throw new Error(`Excel icinde ${report.invalidRows.length} hatali satir var. Import durduruldu.`);
  }
}

async function deleteTableRows(client, columnsByTable, table, action, clubId, studentIds) {
  if (action === "skip") return 0;
  if (table === "students") {
    const result = await client.query("DELETE FROM students WHERE club_id = $1", [clubId]);
    return result.rowCount;
  }
  if (action === "delete_by_student" && hasColumn(columnsByTable, table, "student_id")) {
    const result = await client.query(`DELETE FROM ${table} WHERE student_id = ANY($1::bigint[])`, [studentIds]);
    return result.rowCount;
  }
  if (action === "delete_by_club" && hasColumn(columnsByTable, table, "club_id")) {
    const result = await client.query(`DELETE FROM ${table} WHERE club_id = $1`, [clubId]);
    return result.rowCount;
  }
  return 0;
}

async function cleanOldData(client, columnsByTable, clubId, studentIds, deletePlan) {
  const order = [
    "student_notes",
    "attendance_records",
    "payments",
    "student_groups",
    "student_lessons",
    "attendance_sessions",
    "groups",
    "students"
  ];
  const deleted = {};
  for (const table of order) {
    const plan = deletePlan[table] || { action: "skip" };
    deleted[table] = await deleteTableRows(client, columnsByTable, table, plan.action, clubId, studentIds);
  }
  return deleted;
}

async function insertStudent(client, columnsByTable, student, clubId, branchId) {
  const columns = [
    "status",
    "full_name",
    "program",
    "level",
    "package_code",
    "package_name",
    "parent_name",
    "phone",
    "social_media_permission",
    "monthly_total_sessions",
    "monthly_swimming_sessions",
    "monthly_sport_sessions",
    "monthly_fee",
    "registration_date",
    "note",
    "club_id",
    "branch_id"
  ];
  const values = [
    student.status,
    student.fullName,
    "Y\u00fczme",
    student.level,
    student.packageCode,
    student.packageName,
    null,
    null,
    false,
    student.slots.length * 4,
    student.slots.length * 4,
    0,
    student.monthlyFee,
    student.registrationDate || new Date().toISOString().slice(0, 10),
    null,
    clubId,
    branchId
  ];

  if (hasColumn(columnsByTable, "students", "birth_year")) {
    columns.push("birth_year");
    values.push(student.birthYear);
  }
  if (hasColumn(columnsByTable, "students", "age_group")) {
    columns.push("age_group");
    values.push(student.ageGroup);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO students (${columns.join(", ")})
     VALUES (${placeholders})
     RETURNING id`,
    values
  );
  return rows[0].id;
}

async function insertLesson(client, columnsByTable, studentId, clubId, branchId, slot) {
  const columns = ["student_id", "day_of_week", "start_time"];
  const values = [studentId, slot.day, slot.startTime];
  if (hasColumn(columnsByTable, "student_lessons", "end_time")) {
    columns.push("end_time");
    values.push(slot.endTime);
  }
  if (hasColumn(columnsByTable, "student_lessons", "club_id")) {
    columns.push("club_id");
    values.push(clubId);
  }
  if (hasColumn(columnsByTable, "student_lessons", "branch_id")) {
    columns.push("branch_id");
    values.push(branchId);
  }
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(`INSERT INTO student_lessons (${columns.join(", ")}) VALUES (${placeholders})`, values);
}

async function importData(client, columnsByTable, parsed, clubId, branchId, studentIds, deletePlan) {
  const report = {
    deleted: {},
    insertedStudents: 0,
    insertedLessons: 0,
    skippedRows: parsed.duplicateRows.length + parsed.invalidRows.length
  };

  await client.query("BEGIN");
  try {
    report.deleted = await cleanOldData(client, columnsByTable, clubId, studentIds, deletePlan);

    for (const student of parsed.students) {
      const studentId = await insertStudent(client, columnsByTable, student, clubId, branchId);
      report.insertedStudents += 1;
      for (const slot of student.slots) {
        await insertLesson(client, columnsByTable, studentId, clubId, branchId, slot);
        report.insertedLessons += 1;
      }
    }

    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verifyAfterImport(client, clubId) {
  const students = await client.query("SELECT COUNT(*)::int AS count FROM students WHERE club_id = $1", [clubId]);
  const lessons = await client.query(
    `SELECT day_of_week, start_time, COUNT(DISTINCT student_id)::int AS count
     FROM student_lessons
     WHERE club_id = $1
     GROUP BY day_of_week, start_time
     ORDER BY day_of_week, start_time`,
    [clubId]
  );
  const search = await client.query(
    "SELECT id, full_name FROM students WHERE club_id = $1 AND lower(full_name) LIKE lower($2) ORDER BY lower(full_name) LIMIT 5",
    [clubId, "%alya%"]
  );
  const tuesdaySlots = await client.query(
    `SELECT start_time, COUNT(DISTINCT student_id)::int AS count
     FROM student_lessons
     WHERE club_id = $1 AND lower(day_of_week) = lower($2)
     GROUP BY start_time
     ORDER BY start_time`,
    [clubId, "Sal\u0131"]
  );
  const firstSlot = tuesdaySlots.rows[0];
  let firstSlotStudents = [];
  if (firstSlot) {
    const result = await client.query(
      `SELECT s.id, s.full_name
       FROM student_lessons l
       JOIN students s ON s.id = l.student_id
       WHERE s.club_id = $1
         AND lower(l.day_of_week) = lower($2)
         AND l.start_time = $3
       ORDER BY lower(s.full_name)
       LIMIT 10`,
      [clubId, "Sal\u0131", firstSlot.start_time]
    );
    firstSlotStudents = result.rows;
  }
  const reportRows = await client.query(
    "SELECT COUNT(*)::int AS count FROM attendance_records WHERE club_id = $1",
    [clubId]
  );

  return {
    students: Number(students.rows[0].count || 0),
    lessonSlotRows: lessons.rows,
    searchWorks: search.rows.length > 0,
    searchSample: search.rows,
    attendanceSlotsWork: tuesdaySlots.rows.length > 0,
    attendanceSlotSample: tuesdaySlots.rows,
    lessonStudentsWork: firstSlotStudents.length > 0,
    lessonStudentsSample: firstSlotStudents,
    reportAttendanceRecords: Number(reportRows.rows[0].count || 0)
  };
}

function printSection(title, value) {
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workbook = await loadWorkbook(args.file);
  const parsed = parseStudents(workbook);
  const client = await pool.connect();
  let backup = null;
  let dryRun = null;
  let importReport = null;
  let verification = null;

  try {
    await client.query("SET statement_timeout = '30s'");
    await client.query("SET lock_timeout = '10s'");
    const columnsByTable = await tableColumns(client);
    const club = await fetchClub(client, args.club);
    const branchId = await fetchDefaultBranchId(client, club.id);
    const studentIds = await embaStudentIds(client, club.id);
    const deletePlan = await deletionPlan(client, columnsByTable, club.id, studentIds);

    process.stdout.write(`Excel dosyasi: ${path.resolve(args.file)}\n`);
    process.stdout.write(`Sayfa sayisi: ${workbook.length}\n`);
    process.stdout.write(`Kullanilan sayfa: ${parsed.sheetName}\n`);
    process.stdout.write(`Kulup: ${club.name} (${club.slug})\n`);
    process.stdout.write(`DATABASE_URL: ${getConnectionInfo().databaseUrl}\n`);

    if (args.backup || args.import) {
      backup = await backupTables(client, columnsByTable, club, studentIds);
      printSection("BACKUP RAPORU", {
        directory: backup.directory,
        tables: backup.manifest.tables
      });
    }

    if (args.dryRun || args.import) {
      dryRun = buildDryRunReport(parsed, deletePlan);
      printSection("DRY-RUN RAPORU", dryRun);
      assertDryRunLooksSafe(dryRun, args);
    }

    if (args.import) {
      if (!args.confirm) {
        throw new Error("Import icin --confirm parametresi zorunludur.");
      }
      if (!backup) {
        throw new Error("Import icin once backup alinmalidir. --backup kullanin.");
      }
      importReport = await importData(client, columnsByTable, parsed, club.id, branchId, studentIds, deletePlan);
      printSection("IMPORT RAPORU", importReport);
      verification = await verifyAfterImport(client, club.id);
      printSection("IMPORT SONRASI DOGRULAMA", verification);
    }
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("IMPORT EXCEL HATASI:");
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
