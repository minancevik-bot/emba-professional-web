const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadEnv } = require("../src/env");

const loadedEnvFiles = loadEnv();
const { pool, closePool, getConnectionInfo } = require("../src/db");

function readLegacyData(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  if (!sandbox.window.EMBA_DATA) {
    throw new Error("Bu dosyada window.EMBA_DATA bulunamadi.");
  }
  return sandbox.window.EMBA_DATA;
}

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase("tr-TR");
}

function validStudentName(value) {
  const name = text(value);
  return name && name !== "0" && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(name);
}

function normalizeStatus(status) {
  const value = normalized(status);
  if (value.includes("bekleyen")) return "Bekleyen";
  if (value.includes("ara") || value.includes("pasif")) return "Pasif";
  return "Aktif";
}

function normalizeLevel(level) {
  const value = normalized(level);
  if (value.includes("ileri")) return "İleri";
  if (value.includes("orta")) return "Orta";
  return "Başlangıç";
}

function normalizePackage(packageType) {
  const value = normalized(packageType);
  if (value.includes("bireysel") || value.includes("özel") || value.includes("ozel")) {
    return { code: "OZEL-DERS", name: "Özel Ders", fee: 20000 };
  }
  return { code: "GRUP-YUZME", name: "Grup Yüzme", fee: 6000 };
}

function parseSlot(slot) {
  const cleaned = text(slot).replace(/\s*Txt$/i, "");
  const [day, range] = cleaned.split("|").map((part) => part.trim());
  const time = text(range).split("-")[0].trim();
  if (!day || !time) return null;
  return { day, time };
}

function monthToDate(monthName) {
  const months = {
    ocak: "01",
    şubat: "02",
    mart: "03",
    nisan: "04",
    mayıs: "05",
    haziran: "06",
    temmuz: "07",
    ağustos: "08",
    eylül: "09",
    ekim: "10",
    kasım: "11",
    aralık: "12"
  };
  const parts = text(monthName).split(/\s+/);
  const month = months[normalized(parts[0])] || "01";
  const year = parts.find((part) => /^\d{4}$/.test(part)) || new Date().getFullYear();
  return `${year}-${month}-01`;
}

function errorMessage(error) {
  return error?.message || String(error);
}

async function prepareClient(client) {
  const timeoutMs = getConnectionInfo().statementTimeoutMs || 15000;
  await client.query(`SET statement_timeout = ${Number(timeoutMs)}`);
  await client.query(`SET lock_timeout = ${Number(timeoutMs)}`);
}

async function findExistingStudent(client, fullName) {
  const result = await client.query(
    `SELECT id
     FROM students
     WHERE full_name = $1 OR lower(full_name) = $2
     ORDER BY id ASC
     LIMIT 1`,
    [text(fullName), normalized(fullName)]
  );
  return result.rows[0]?.id || null;
}

async function insertStudent(client, legacy) {
  const fullName = text(legacy.name);
  const pkg = normalizePackage(legacy.packageType);
  const result = await client.query(
    `INSERT INTO students (
      status, full_name, program, level, package_code, package_name, parent_name, phone,
      monthly_total_sessions, monthly_swimming_sessions, monthly_sport_sessions,
      monthly_fee, registration_date, note
    )
    VALUES ($1, $2, 'Yüzme', $3, $4, $5, $6, $7, 8, 8, 0, $8, $9, $10)
    RETURNING id`,
    [
      normalizeStatus(legacy.status),
      fullName,
      normalizeLevel(legacy.level),
      pkg.code,
      pkg.name,
      text(legacy.parentName) || null,
      text(legacy.phone) || null,
      pkg.fee,
      legacy.recordDate || new Date().toISOString().slice(0, 10),
      text(legacy.note) || null
    ]
  );
  return result.rows[0].id;
}

async function insertLessonIfMissing(client, studentId, slot) {
  const existing = await client.query(
    `SELECT id
     FROM student_lessons
     WHERE student_id = $1 AND day_of_week = $2 AND start_time = $3
     LIMIT 1`,
    [studentId, slot.day, slot.time]
  );
  if (existing.rows[0]) return false;

  await client.query(
    "INSERT INTO student_lessons (student_id, day_of_week, start_time) VALUES ($1, $2, $3)",
    [studentId, slot.day, slot.time]
  );
  return true;
}

async function insertPaymentIfMissing(client, payment) {
  const existing = await client.query(
    `SELECT id
     FROM payments
     WHERE student_id = $1
       AND period_month = $2
       AND monthly_fee = $3
       AND paid_amount = $4
       AND COALESCE(payment_date::text, '') = COALESCE($5::text, '')
       AND COALESCE(method, '') = COALESCE($6, '')
       AND COALESCE(description, '') = COALESCE($7, '')
     LIMIT 1`,
    [
      payment.studentId,
      payment.periodMonth,
      payment.monthlyFee,
      payment.paidAmount,
      payment.paymentDate,
      payment.method,
      payment.description
    ]
  );
  if (existing.rows[0]) return false;

  await client.query(
    `INSERT INTO payments
      (student_id, period_month, monthly_fee, paid_amount, payment_date, method, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      payment.studentId,
      payment.periodMonth,
      payment.monthlyFee,
      payment.paidAmount,
      payment.paymentDate,
      payment.method,
      payment.description
    ]
  );
  return true;
}

async function processStudent(client, legacy, counts, studentIdByName) {
  const fullName = text(legacy.name);
  try {
    let studentId = await findExistingStudent(client, fullName);
    if (studentId) {
      counts.studentsSkipped += 1;
    } else {
      studentId = await insertStudent(client, legacy);
      counts.studentsInserted += 1;
    }

    studentIdByName.set(normalized(fullName), studentId);

    const slots = Array.isArray(legacy.slots) ? legacy.slots : [legacy.slots];
    for (const rawSlot of slots) {
      const slot = parseSlot(rawSlot);
      if (!slot) continue;
      if (await insertLessonIfMissing(client, studentId, slot)) {
        counts.lessonsInserted += 1;
      }
    }
  } catch (error) {
    counts.studentsFailed += 1;
    console.error(`Ogrenci hatasi: ${fullName} - ${errorMessage(error)}`);
  }
}

async function processPayment(client, legacyPayment, periodMonth, counts, studentIdByName) {
  const studentName = text(legacyPayment.student);
  try {
    const studentId = studentIdByName.get(normalized(studentName)) || (await findExistingStudent(client, studentName));
    if (!studentId) {
      counts.paymentsSkipped += 1;
      return;
    }

    const fee = Number(legacyPayment.fee || 0);
    const paid = Number(legacyPayment.paid || 0);
    if (!fee && !paid) {
      counts.paymentsSkipped += 1;
      return;
    }

    const inserted = await insertPaymentIfMissing(client, {
      studentId,
      periodMonth,
      monthlyFee: fee,
      paidAmount: paid,
      paymentDate: text(legacyPayment.paymentDate) || null,
      method: text(legacyPayment.method) || null,
      description: text(legacyPayment.note) || null
    });

    if (inserted) counts.paymentsInserted += 1;
    else counts.paymentsSkipped += 1;
  } catch (error) {
    counts.paymentsFailed += 1;
    console.error(`Odeme hatasi: ${studentName || "(isimsiz)"} - ${errorMessage(error)}`);
  }
}

async function main() {
  const defaultFile = path.join(__dirname, "..", "..", "emba-yuzme-app", "data.js");
  const requestedFile = process.argv.slice(2).find((arg) => arg.endsWith(".js"));
  const filePath = path.resolve(requestedFile || defaultFile);

  if (process.argv.includes("--clear")) {
    process.stdout.write("--clear parametresi devre disi: hicbir tablo silinmeyecek.\n");
  }

  const data = readLegacyData(filePath);
  const legacyStudents = (data.students || []).filter((student) => validStudentName(student.name));
  const paymentRows = (data.months || []).flatMap((month) => (
    (month.payments || []).map((payment) => ({
      payment,
      periodMonth: monthToDate(month.name)
    }))
  ));
  const connectionInfo = getConnectionInfo();

  process.stdout.write(`Env dosyalari: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "bulunamadi"}\n`);
  process.stdout.write(`Baglanilan DATABASE_URL: ${connectionInfo.databaseUrl}\n`);
  process.stdout.write(`SSL aktif: ${connectionInfo.sslEnabled ? "evet" : "hayir"}\n`);
  process.stdout.write(`Query timeout: ${connectionInfo.queryTimeoutMs} ms\n`);
  process.stdout.write(`Statement timeout: ${connectionInfo.statementTimeoutMs} ms\n`);
  process.stdout.write(`Eski veri dosyasi: ${filePath}\n`);
  process.stdout.write(`Eski dosyada ogrenci sayisi: ${legacyStudents.length}\n`);
  process.stdout.write(`Eski dosyada odeme satiri sayisi: ${paymentRows.length}\n`);

  const client = await pool.connect();
  const counts = {
    studentsRead: legacyStudents.length,
    studentsInserted: 0,
    studentsSkipped: 0,
    studentsFailed: 0,
    lessonsInserted: 0,
    paymentsRead: paymentRows.length,
    paymentsInserted: 0,
    paymentsSkipped: 0,
    paymentsFailed: 0
  };
  const studentIdByName = new Map();

  try {
    await prepareClient(client);
    const dbInfo = await client.query("SELECT current_database() AS database, current_user AS user, current_schema() AS schema");
    process.stdout.write(
      `PostgreSQL hedefi: database=${dbInfo.rows[0].database}, user=${dbInfo.rows[0].user}, schema=${dbInfo.rows[0].schema}\n`
    );

    for (let index = 0; index < legacyStudents.length; index += 1) {
      await processStudent(client, legacyStudents[index], counts, studentIdByName);
      const done = index + 1;
      if (done % 10 === 0 || done === legacyStudents.length) {
        process.stdout.write(`${done}/${legacyStudents.length} ogrenci islendi.\n`);
      }
    }

    for (let index = 0; index < paymentRows.length; index += 1) {
      await processPayment(client, paymentRows[index].payment, paymentRows[index].periodMonth, counts, studentIdByName);
      const done = index + 1;
      if (done % 50 === 0 || done === paymentRows.length) {
        process.stdout.write(`${done}/${paymentRows.length} odeme islendi.\n`);
      }
    }
  } finally {
    client.release();
  }

  process.stdout.write("Import raporu:\n");
  process.stdout.write(`Okunan ogrenci: ${counts.studentsRead}\n`);
  process.stdout.write(`Eklenen ogrenci: ${counts.studentsInserted}\n`);
  process.stdout.write(`Atlanan ogrenci: ${counts.studentsSkipped}\n`);
  process.stdout.write(`Hatali ogrenci: ${counts.studentsFailed}\n`);
  process.stdout.write(`Eklenen ders saati: ${counts.lessonsInserted}\n`);
  process.stdout.write(`Okunan odeme: ${counts.paymentsRead}\n`);
  process.stdout.write(`Eklenen odeme: ${counts.paymentsInserted}\n`);
  process.stdout.write(`Atlanan odeme: ${counts.paymentsSkipped}\n`);
  process.stdout.write(`Hatali odeme: ${counts.paymentsFailed}\n`);
}

main()
  .catch((error) => {
    console.error("IMPORT HATASI:");
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
