const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../src/env");

loadEnv();

const { pool, closePool, getConnectionInfo } = require("../src/db");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_BACKUP_DIR = path.join(PROJECT_ROOT, "backups", "2026-06-22-16-08-before-excel-import");
const TURKEY_TIME_ZONE = "Europe/Istanbul";

function parseArgs(argv) {
  const args = {
    backupDir: DEFAULT_BACKUP_DIR,
    club: "emba",
    dryRun: false,
    restore: false,
    confirm: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--backup-dir") args.backupDir = path.resolve(argv[++index] || "");
    else if (arg === "--club") args.club = String(argv[++index] || "").trim();
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--restore") args.restore = true;
    else if (arg === "--confirm") args.confirm = true;
  }

  return args;
}

function readBackupJson(filePath, expectedTable) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup dosyasi bulunamadi: ${filePath}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (data.table !== expectedTable || !Array.isArray(data.rows)) {
    throw new Error(`Backup dosyasi beklenen formatta degil: ${filePath}`);
  }
  return data.rows;
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return text(value).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function nameTokens(value) {
  return normalizeName(value).split(" ").filter((part) => part.length >= 2);
}

function tokenSubsetCandidates(oldStudent, currentStudents) {
  const oldTokens = nameTokens(oldStudent.full_name);
  if (oldTokens.length < 2) return [];
  return currentStudents.filter((student) => {
    const currentTokens = new Set(nameTokens(student.full_name));
    return oldTokens.every((token) => currentTokens.has(token));
  });
}

function phoneDigits(value) {
  return text(value).replace(/\D/g, "");
}

function amountKey(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateInTurkey(value);
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateInTurkey(date);
}

function formatDateInTurkey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TURKEY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timestampOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function paymentKey(payment, newStudentId = payment.student_id) {
  return [
    String(newStudentId || ""),
    dateOnly(payment.period_month) || "",
    amountKey(payment.monthly_fee),
    amountKey(payment.paid_amount),
    dateOnly(payment.payment_date) || "",
    text(payment.method),
    text(payment.description)
  ].join("|");
}

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

async function fetchClub(client, slug) {
  const { rows } = await client.query("SELECT id, name, slug FROM clubs WHERE slug = $1 LIMIT 1", [slug]);
  if (!rows[0]) throw new Error(`Kulup bulunamadi: ${slug}`);
  return rows[0];
}

async function fetchCurrentStudents(client, clubId) {
  const { rows } = await client.query(
    `SELECT id, full_name, phone, alternate_phone, birth_year, club_id, branch_id
     FROM students
     WHERE club_id = $1
     ORDER BY lower(full_name) ASC, id ASC`,
    [clubId]
  );
  return rows;
}

async function fetchExistingPayments(client, clubId) {
  const { rows } = await client.query(
    `SELECT id, student_id, period_month, monthly_fee, paid_amount, payment_date, method, description
     FROM payments
     WHERE club_id = $1`,
    [clubId]
  );
  return rows;
}

async function fetchValidUserIds(client) {
  const { rows } = await client.query("SELECT id FROM users");
  return new Set(rows.map((row) => String(row.id)));
}

function matchStudents(oldStudents, currentStudents) {
  const currentByName = new Map();
  for (const student of currentStudents) {
    addToIndex(currentByName, normalizeName(student.full_name), student);
  }

  const matchesByOldId = new Map();
  const unmatchedOldStudents = [];
  const suspiciousStudents = [];

  for (const oldStudent of oldStudents) {
    const name = normalizeName(oldStudent.full_name);
    let candidates = currentByName.get(name) || [];
    if (!candidates.length) {
      candidates = tokenSubsetCandidates(oldStudent, currentStudents);
    }
    const oldPhone = phoneDigits(oldStudent.phone || oldStudent.alternate_phone);
    const oldBirthYear = oldStudent.birth_year ? String(oldStudent.birth_year) : "";

    if (candidates.length > 1 && oldPhone) {
      const byPhone = candidates.filter((student) => {
        const currentPhone = phoneDigits(student.phone || student.alternate_phone);
        return currentPhone && currentPhone === oldPhone;
      });
      if (byPhone.length) candidates = byPhone;
    }

    if (candidates.length > 1 && oldBirthYear) {
      const byBirthYear = candidates.filter((student) => String(student.birth_year || "") === oldBirthYear);
      if (byBirthYear.length) candidates = byBirthYear;
    }

    if (candidates.length === 1) {
      matchesByOldId.set(String(oldStudent.id), candidates[0]);
    } else if (!candidates.length) {
      unmatchedOldStudents.push({
        oldId: oldStudent.id,
        fullName: oldStudent.full_name,
        phone: oldStudent.phone || oldStudent.alternate_phone || null,
        birthYear: oldStudent.birth_year || null
      });
    } else {
      suspiciousStudents.push({
        oldId: oldStudent.id,
        fullName: oldStudent.full_name,
        candidates: candidates.map((student) => ({
          id: student.id,
          fullName: student.full_name,
          phone: student.phone || student.alternate_phone || null,
          birthYear: student.birth_year || null
        }))
      });
    }
  }

  return { matchesByOldId, unmatchedOldStudents, suspiciousStudents };
}

function buildPaymentRestorePlan({ backupPayments, backupStudents, currentStudents, existingPayments }) {
  const oldStudentById = new Map(backupStudents.map((student) => [String(student.id), student]));
  const { matchesByOldId, unmatchedOldStudents, suspiciousStudents } = matchStudents(backupStudents, currentStudents);
  const existingKeys = new Set(existingPayments.map((payment) => paymentKey(payment)));
  const backupDuplicateKeys = new Set();
  const planned = [];
  const duplicatePayments = [];
  const unmatchedPayments = [];
  const periodDistribution = new Map();
  let totalPaidAmount = 0;

  for (const payment of backupPayments) {
    const oldStudentId = String(payment.student_id || "");
    const oldStudent = oldStudentById.get(oldStudentId);
    const newStudent = matchesByOldId.get(oldStudentId);
    if (!oldStudent || !newStudent) {
      unmatchedPayments.push({
        paymentId: payment.id,
        oldStudentId,
        oldStudentName: oldStudent?.full_name || "(backup ogrencisi bulunamadi)",
        periodMonth: dateOnly(payment.period_month),
        paidAmount: Number(payment.paid_amount || 0)
      });
      continue;
    }

    const mapped = {
      ...payment,
      oldStudentId,
      oldStudentName: oldStudent.full_name,
      newStudentId: newStudent.id,
      newStudentName: newStudent.full_name,
      newClubId: newStudent.club_id,
      newBranchId: newStudent.branch_id,
      period_month: dateOnly(payment.period_month),
      payment_date: dateOnly(payment.payment_date),
      created_at: timestampOrNull(payment.created_at),
      updated_at: timestampOrNull(payment.updated_at)
    };
    const key = paymentKey(mapped, newStudent.id);
    if (existingKeys.has(key) || backupDuplicateKeys.has(key)) {
      duplicatePayments.push({
        paymentId: payment.id,
        oldStudentName: oldStudent.full_name,
        newStudentName: newStudent.full_name,
        periodMonth: mapped.period_month,
        paidAmount: Number(payment.paid_amount || 0)
      });
      continue;
    }

    backupDuplicateKeys.add(key);
    planned.push(mapped);
    totalPaidAmount += Number(payment.paid_amount || 0);
    const period = mapped.period_month || "tarih-yok";
    const current = periodDistribution.get(period) || { count: 0, paidAmount: 0 };
    current.count += 1;
    current.paidAmount += Number(payment.paid_amount || 0);
    periodDistribution.set(period, current);
  }

  const oldStudentIdsWithPayments = new Set(backupPayments.map((payment) => String(payment.student_id || "")));
  const unmatchedStudentsWithPayments = unmatchedOldStudents.filter((student) => oldStudentIdsWithPayments.has(String(student.oldId)));
  const suspiciousStudentsWithPayments = suspiciousStudents.filter((student) => oldStudentIdsWithPayments.has(String(student.oldId)));

  return {
    backupPaymentCount: backupPayments.length,
    backupStudentCount: backupStudents.length,
    currentStudentCount: currentStudents.length,
    matchedOldStudentCount: matchesByOldId.size,
    matchedOldStudentsWithPayments: new Set(planned.map((payment) => String(payment.oldStudentId))).size,
    unmatchedOldStudents,
    unmatchedStudentsWithPayments,
    suspiciousStudents,
    suspiciousStudentsWithPayments,
    matchedPaymentCount: planned.length + duplicatePayments.length,
    unmatchedPaymentCount: unmatchedPayments.length,
    duplicatePaymentCount: duplicatePayments.length,
    restorablePaymentCount: planned.length,
    totalPaidAmount,
    periodDistribution: Object.fromEntries([...periodDistribution.entries()].sort(([a], [b]) => a.localeCompare(b))),
    planned,
    unmatchedPayments,
    duplicatePayments
  };
}

function publicReport(plan) {
  return {
    backupPaymentCount: plan.backupPaymentCount,
    backupStudentCount: plan.backupStudentCount,
    currentStudentCount: plan.currentStudentCount,
    matchedOldStudentCount: plan.matchedOldStudentCount,
    matchedOldStudentsWithPayments: plan.matchedOldStudentsWithPayments,
    unmatchedOldStudentCount: plan.unmatchedOldStudents.length,
    unmatchedStudentsWithPayments: plan.unmatchedStudentsWithPayments,
    suspiciousStudentCount: plan.suspiciousStudents.length,
    suspiciousStudentsWithPayments: plan.suspiciousStudentsWithPayments,
    matchedPaymentCount: plan.matchedPaymentCount,
    unmatchedPaymentCount: plan.unmatchedPaymentCount,
    duplicatePaymentCount: plan.duplicatePaymentCount,
    restorablePaymentCount: plan.restorablePaymentCount,
    totalPaidAmount: Number(plan.totalPaidAmount.toFixed(2)),
    periodDistribution: plan.periodDistribution,
    unmatchedPaymentSample: plan.unmatchedPayments.slice(0, 20),
    duplicatePaymentSample: plan.duplicatePayments.slice(0, 20)
  };
}

function assertSafeToRestore(plan) {
  if (plan.unmatchedPaymentCount > 0) {
    throw new Error(`${plan.unmatchedPaymentCount} odeme eslesmedi. Restore durduruldu.`);
  }
  if (plan.suspiciousStudentsWithPayments.length > 0) {
    throw new Error(`${plan.suspiciousStudentsWithPayments.length} odemesi olan ogrencide birden fazla eslesme var. Restore durduruldu.`);
  }
  if (plan.restorablePaymentCount < 1 && plan.duplicatePaymentCount < 1) {
    throw new Error("Geri yuklenecek odeme bulunamadi. Restore durduruldu.");
  }
}

async function restorePayments(client, plan) {
  const validUserIds = await fetchValidUserIds(client);
  const report = {
    insertedPayments: 0,
    skippedDuplicates: plan.duplicatePaymentCount
  };

  await client.query("BEGIN");
  try {
    for (let index = 0; index < plan.planned.length; index += 1) {
      const payment = plan.planned[index];
      const createdBy = payment.created_by && validUserIds.has(String(payment.created_by)) ? payment.created_by : null;
      await client.query(
        `INSERT INTO payments (
          student_id, club_id, branch_id, period_month, monthly_fee, paid_amount,
          payment_date, method, description, created_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()), COALESCE($12::timestamptz, now()))`,
        [
          payment.newStudentId,
          payment.newClubId,
          payment.newBranchId,
          payment.period_month,
          payment.monthly_fee,
          payment.paid_amount,
          payment.payment_date,
          payment.method || null,
          payment.description || null,
          createdBy,
          payment.created_at,
          payment.updated_at
        ]
      );
      report.insertedPayments += 1;
      const done = index + 1;
      if (done % 50 === 0 || done === plan.planned.length) {
        process.stdout.write(`${done}/${plan.planned.length} odeme geri yuklendi.\n`);
      }
    }
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function verificationReport(client, clubId) {
  const counts = await client.query(
    `SELECT
       COUNT(*)::int AS payment_count,
       COUNT(DISTINCT student_id)::int AS students_with_payments,
       COALESCE(SUM(paid_amount), 0)::numeric AS total_paid
     FROM payments
     WHERE club_id = $1`,
    [clubId]
  );
  const periods = await client.query(
    `SELECT period_month, COUNT(*)::int AS count, COALESCE(SUM(paid_amount), 0)::numeric AS paid_amount
     FROM payments
     WHERE club_id = $1
     GROUP BY period_month
     ORDER BY period_month`,
    [clubId]
  );
  const pageQuerySample = await client.query(
    `SELECT p.id, p.period_month, p.monthly_fee, p.paid_amount, p.payment_date,
            s.full_name AS student_name, s.parent_name, s.phone
     FROM payments p
     JOIN students s ON s.id = p.student_id
     WHERE p.club_id = $1
     ORDER BY lower(s.full_name), p.period_month DESC
     LIMIT 10`,
    [clubId]
  );
  const detailSample = await client.query(
    `SELECT s.id, s.full_name, COUNT(p.id)::int AS payment_count
     FROM students s
     JOIN payments p ON p.student_id = s.id
     WHERE s.club_id = $1
     GROUP BY s.id, s.full_name
     ORDER BY COUNT(p.id) DESC, lower(s.full_name)
     LIMIT 10`,
    [clubId]
  );
  return {
    paymentCount: Number(counts.rows[0].payment_count || 0),
    studentsWithPayments: Number(counts.rows[0].students_with_payments || 0),
    totalPaid: Number(counts.rows[0].total_paid || 0),
    periodDistribution: periods.rows,
    paymentsPageQueryWorks: pageQuerySample.rows.length > 0,
    paymentsPageSample: pageQuerySample.rows,
    studentDetailPaymentQueryWorks: detailSample.rows.length > 0,
    studentDetailSample: detailSample.rows
  };
}

function printJson(title, value) {
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.restore) args.dryRun = true;

  const backupDir = path.resolve(args.backupDir);
  const studentsPath = path.join(backupDir, "students.json");
  const paymentsPath = path.join(backupDir, "payments.json");
  const backupStudents = readBackupJson(studentsPath, "students");
  const backupPayments = readBackupJson(paymentsPath, "payments");

  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = '30s'");
    await client.query("SET lock_timeout = '10s'");
    const club = await fetchClub(client, args.club);
    const currentStudents = await fetchCurrentStudents(client, club.id);
    const existingPayments = await fetchExistingPayments(client, club.id);
    const plan = buildPaymentRestorePlan({
      backupPayments,
      backupStudents,
      currentStudents,
      existingPayments
    });

    process.stdout.write(`Backup klasoru: ${backupDir}\n`);
    process.stdout.write(`Students backup: ${studentsPath}\n`);
    process.stdout.write(`Payments backup: ${paymentsPath}\n`);
    process.stdout.write(`Kulup: ${club.name} (${club.slug})\n`);
    process.stdout.write(`DATABASE_URL: ${getConnectionInfo().databaseUrl}\n`);
    printJson("DRY-RUN RAPORU", publicReport(plan));

    if (args.restore) {
      if (!args.confirm) {
        throw new Error("Restore icin --confirm parametresi zorunludur.");
      }
      assertSafeToRestore(plan);
      const restoreReport = await restorePayments(client, plan);
      printJson("RESTORE RAPORU", restoreReport);
      printJson("RESTORE SONRASI DOGRULAMA", await verificationReport(client, club.id));
    }
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error("PAYMENT RESTORE HATASI:");
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
