require("./env").loadEnv();

const path = require("path");
const express = require("express");
const multer = require("multer");
const readXlsxFile = require("read-excel-file/node");
const { pool, query, transaction } = require("./db");
const {
  hashPassword,
  verifyPassword,
  makeSessionToken,
  tokenHash,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  sessionExpiresAt
} = require("./auth");
const {
  roleLabel,
  permissionsFor,
  can,
  normalizeUserRole,
  isSuperAdmin,
  isCoach,
  normalizeCreatableRole
} = require("./permissions");
const { runBackup, scheduleBackups } = require("./backup");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

// CORS — mobil uygulama desteği
const ALLOWED_ORIGINS = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://localhost:3000"
];
app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  next();
});

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function publicUser(user) {
  if (!user) return null;
  const normalizedRole = user.normalizedRole || normalizeUserRole(user);
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name || user.fullName,
    role: user.role,
    normalizedRole,
    roleLabel: roleLabel(normalizedRole),
    clubId: user.club_id || user.clubId || null,
    active: user.active,
    createdAt: user.created_at || user.createdAt || null,
    updatedAt: user.updated_at || user.updatedAt || null,
    permissions: permissionsFor(normalizedRole)
  };
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

async function defaultClubId(client = null) {
  const runner = client ? (text, params) => client.query(text, params) : query;
  const { rows } = await runner("SELECT id FROM clubs WHERE slug = $1", ["emba"]);
  return rows[0]?.id || null;
}

async function defaultBranchId(client, clubId) {
  if (!clubId) return null;
  const runner = client ? (text, params) => client.query(text, params) : query;
  const { rows } = await runner(
    `SELECT id
     FROM branches
     WHERE club_id = $1 AND active = TRUE
     ORDER BY CASE WHEN name = 'Ana Şube / Ana Salon' THEN 0 ELSE 1 END, id
     LIMIT 1`,
    [clubId]
  );
  return rows[0]?.id || null;
}

async function ensureDefaultBranchId(client, clubId) {
  const existing = await defaultBranchId(client, clubId);
  if (existing) return existing;
  const { rows } = await client.query(
    `INSERT INTO branches (club_id, name, type, active)
     VALUES ($1, $2, 'branch', TRUE)
     RETURNING id`,
    [clubId, "Ana Şube / Ana Salon"]
  );
  return rows[0]?.id || null;
}

function getUserClubId(user) {
  return user?.club_id || user?.clubId || null;
}

function getSelectedClubId(request) {
  const value = request.query.clubId || request.body?.clubId || request.headers["x-club-id"];
  const clubId = Number(value);
  return Number.isInteger(clubId) && clubId > 0 ? clubId : null;
}

function addTenantFilter(filters, params, user, alias) {
  if (isSuperAdmin(user)) {
    if (!user?.selectedClubId) return;
    params.push(user.selectedClubId);
    filters.push(`${alias}.club_id = $${params.length}`);
    return;
  }
  const clubId = getUserClubId(user);
  if (!clubId) {
    filters.push("1 = 0");
    return;
  }
  params.push(clubId);
  filters.push(`${alias}.club_id = $${params.length}`);
}

function addStudentAccessFilter(filters, params, user, alias = "s") {
  addTenantFilter(filters, params, user, alias);
}

const CLUB_MANAGED_ROLES = new Set(["manager", "coach", "assistant"]);
const CLUB_MANAGED_DATABASE_ROLES = ["manager", "coach", "assistant", "antrenor"];
const SYSTEM_USER_ROLES = new Set(["admin", "super_admin", "automation_admin", "automation"]);

function isSystemUserRole(row) {
  const rawRole = String(row?.role || "").trim();
  const username = String(row?.username || "").trim().toLowerCase();
  return SYSTEM_USER_ROLES.has(rawRole) || normalizeUserRole(row) === "super_admin" || username === "admin";
}

function canManageClubUser(actor, target) {
  if (isSuperAdmin(actor)) return true;
  if (!target || isSystemUserRole(target)) return false;
  if (String(getUserClubId(actor) || "") !== String(target.club_id || target.clubId || "")) return false;
  return CLUB_MANAGED_ROLES.has(normalizeUserRole(target));
}

function addClubManagedUserFilter(filters, params, user, alias = "users") {
  if (isSuperAdmin(user)) return;
  params.push(CLUB_MANAGED_DATABASE_ROLES);
  filters.push(`${alias}.role = ANY($${params.length}::text[])`);
}

function addAttendanceAccessFilter(filters, params, user, attendanceAlias = "a") {
  addTenantFilter(filters, params, user, attendanceAlias);
  if (!isCoach(user)) return;
  params.push(user.id);
  filters.push(`${attendanceAlias}.recorded_by = $${params.length}`);
}

function addReportAttendanceAccessFilter(filters, params, request, attendanceAlias = "a") {
  if (isSuperAdmin(request.user)) {
    const clubId = Number(request.query.clubId || 0);
    if (Number.isInteger(clubId) && clubId > 0) {
      params.push(clubId);
      filters.push(`${attendanceAlias}.club_id = $${params.length}`);
    }
    return;
  }
  addAttendanceAccessFilter(filters, params, request.user, attendanceAlias);
}

function validAttendanceEditStatus(status) {
  return ["present", "absent", "excused"].includes(status) ? status : null;
}

function canResetAttendanceSession(user) {
  const role = normalizeUserRole(user);
  return role === "manager" || role === "super_admin";
}

function validAttendanceResetConfirm(value) {
  const normalized = String(value || "").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
  return ["SIFIRLA", "TEMIZLE"].includes(normalized);
}

function hasForbiddenClubOverride(request) {
  if (isSuperAdmin(request.user)) return false;
  const requestedClubId = getSelectedClubId(request);
  return requestedClubId && String(requestedClubId) !== String(getUserClubId(request.user) || "");
}

function parseAttendanceSessionId(value) {
  const parts = String(value || "").split("_");
  if (parts.length < 3) return null;
  const lessonDate = parts[0];
  const startTime = normalizeLessonTime(parts[1]);
  const clubId = Number(parts[2]);
  if (!validDateOrNull(lessonDate) || !startTime || !Number.isInteger(clubId) || clubId <= 0) return null;
  return { lessonDate, startTime, clubId };
}

function attendanceClearClubId(request) {
  const requestedClubId = getSelectedClubId(request);
  if (isSuperAdmin(request.user)) return requestedClubId || request.user?.selectedClubId || null;
  const clubId = getUserClubId(request.user);
  if (requestedClubId && String(requestedClubId) !== String(clubId || "")) return null;
  return clubId || null;
}

function whereClause(filters) {
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

async function resolveWriteClubId(client, request) {
  if (isSuperAdmin(request.user)) return getSelectedClubId(request);
  return getUserClubId(request.user) || defaultClubId(client);
}

async function resolveWriteBranchId(client, request, clubId) {
  if (request.body?.branchId) return Number(request.body.branchId);
  return defaultBranchId(client, clubId);
}

async function fetchAccessibleStudentMeta(client, user, studentId) {
  const params = [studentId];
  const filters = ["s.id = $1"];
  addStudentAccessFilter(filters, params, user, "s");
  const { rows } = await client.query(
    `SELECT s.id, s.full_name, s.status, s.passive_date, s.club_id, s.branch_id, s.monthly_fee
     FROM students s
     ${whereClause(filters)}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function fetchPaymentForWrite(client, user, paymentId) {
  const { rows } = await client.query(
    `SELECT p.*, s.full_name AS student_name
     FROM payments p
     JOIN students s ON s.id = p.student_id
     WHERE p.id = $1
     LIMIT 1`,
    [paymentId]
  );
  const payment = rows[0] || null;
  if (!payment) return { payment: null, forbidden: false };
  const scopedClubId = isSuperAdmin(user) ? user.selectedClubId : getUserClubId(user);
  if (!scopedClubId || String(payment.club_id) !== String(scopedClubId)) {
    return { payment, forbidden: true };
  }
  return { payment, forbidden: false };
}

async function requireAuth(request, response, next) {
  const token = getSessionToken(request);
  if (!token) {
    response.status(401).json({ error: "Oturum bulunamadi." });
    return;
  }

  const { rows } = await query(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       u.id,
       u.username,
       u.full_name,
       u.role,
       u.club_id,
       u.active
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash(token)]
  );

  const user = rows[0];
  if (!user || !user.active || new Date(user.expires_at) <= new Date()) {
    clearSessionCookie(response, request);
    response.status(401).json({ error: "Oturum suresi doldu." });
    return;
  }

  user.normalizedRole = normalizeUserRole(user);
  user.selectedClubId = getSelectedClubId(request);
  if (!isSuperAdmin(user) && !user.club_id) {
    user.club_id = await defaultClubId();
  }
  if (!isSuperAdmin(user) && !user.club_id) {
    clearSessionCookie(response, request);
    response.status(403).json({ error: "Kullanici kulup baglantisi bulunamadi." });
    return;
  }

  request.user = user;
  request.sessionToken = token;
  request.sessionId = user.session_id;
  await query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [user.session_id]);
  next();
}

function requirePermission(permission) {
  return (request, response, next) => {
    if (can(request.user, permission)) {
      next();
      return;
    }
    response.status(403).json({ error: "Bu islem icin yetkiniz yok." });
  };
}

function requireSelectedClubForSuperAdmin(request, response, next) {
  if (isSuperAdmin(request.user) && !request.user.selectedClubId) {
    response.status(400).json({ error: "Once KulupAsist Merkez uzerinden bir kulup secilmelidir." });
    return;
  }
  next();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function boolValue(value) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function slugify(value) {
  const map = {
    ç: "c",
    Ç: "c",
    ğ: "g",
    Ğ: "g",
    ı: "i",
    I: "i",
    İ: "i",
    ö: "o",
    Ö: "o",
    ş: "s",
    Ş: "s",
    ü: "u",
    Ü: "u"
  };
  return String(value || "")
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (letter) => map[letter] || letter)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function clubPayload(body) {
  const name = nullableText(body.name);
  const statusValue = body.status === "passive" ? "inactive" : body.status;
  return {
    name,
    slug: slugify(body.slug || name),
    logoUrl: nullableText(body.logoUrl),
    phone: nullableText(body.phone),
    email: nullableText(body.email),
    city: nullableText(body.city),
    district: nullableText(body.district),
    address: nullableText(body.address),
    status: ["active", "inactive", "suspended"].includes(statusValue) ? statusValue : "active",
    plan: ["free", "standard", "owner", "pro", "enterprise"].includes(body.plan) ? body.plan : "standard"
  };
}

function optionalClubUserPayload(body) {
  const user = body?.user || {};
  const createUser = body?.createUser === true || body?.createUser === "true";
  if (!createUser) return null;
  return {
    username: nullableText(user.username || body.adminUsername),
    fullName: nullableText(user.fullName || body.adminFullName),
    role: normalizeCreatableRole(user.role || body.adminRole || "manager"),
    password: String(user.password || body.adminPassword || ""),
    passwordConfirm: user.passwordConfirm ?? body.adminPasswordConfirm
  };
}

function mapClub(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    phone: row.phone,
    email: row.email,
    city: row.city,
    district: row.district,
    address: row.address,
    status: row.status,
    plan: row.plan,
    studentCount: Number(row.student_count || 0),
    activeStudentCount: Number(row.active_student_count || 0),
    userCount: Number(row.user_count || 0),
    currentMonthPaid: Number(row.current_month_paid || 0),
    currentMonthDebt: Number(row.current_month_debt || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePeriodMonth(value) {
  const input = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(input)) return `${input}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input.slice(0, 7)}-01`;
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function validPeriodMonth(value) {
  const input = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(input)) return `${input}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input.slice(0, 7)}-01`;
  return null;
}

function validDateOrNull(value) {
  if (value === undefined) return undefined;
  const input = String(value || "").trim();
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const date = new Date(`${input}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : input;
}

function nonNegativeAmount(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeLessonTime(value) {
  const input = String(value || "").trim().replace(".", ":");
  const match = input.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || ![0, 30].includes(minute)) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function lessonTimeSql(alias) {
  return `lpad(split_part(replace(${alias}.start_time, '.', ':'), ':', 1), 2, '0') || ':' || lpad(split_part(replace(${alias}.start_time, '.', ':'), ':', 2), 2, '0')`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return today();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function passiveEligibilitySql(alias, paramRef) {
  return `(
    ${alias}.status <> 'Pasif'
    OR ${alias}.passive_date IS NULL
    OR ${paramRef}::date < (date_trunc('month', ${alias}.passive_date)::date + INTERVAL '1 month')
  )`;
}

function studentEligibleForDateSqlCheck(student, targetDate) {
  if (!student || String(student.status || "") !== "Pasif") return true;
  if (!student.passive_date) return true;
  const passiveDate = new Date(`${dateOnly(student.passive_date)}T12:00:00`);
  const effective = new Date(passiveDate.getFullYear(), passiveDate.getMonth() + 1, 1, 12);
  const target = new Date(`${dateOnly(targetDate)}T12:00:00`);
  return target < effective;
}

function dayNameForDate(value) {
  const date = new Date(`${value || today()}T12:00:00`);
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(date);
}

function normalizeAttendanceStatus(value) {
  return ["present", "absent", "excused", "blank"].includes(value) ? value : "present";
}

function studentPayload(body) {
  const status = ["Aktif", "Bekleyen", "Pasif"].includes(body.status) ? body.status : "Aktif";
  const passiveDate = status === "Pasif" ? validDateOrNull(body.passiveDate || today()) : null;
  if (passiveDate === undefined) {
    throw httpError("Gecersiz pasife alma tarihi.", 400);
  }
  return {
    status,
    passiveDate,
    fullName: nullableText(body.fullName),
    program: nullableText(body.program) || "Yüzme",
    level: nullableText(body.level) || "Başlangıç",
    packageCode: nullableText(body.packageCode),
    packageName: nullableText(body.packageName),
    parentName: nullableText(body.parentName),
    phone: nullableText(body.phone),
    socialMediaPermission: boolValue(body.socialMediaPermission),
    monthlyTotalSessions: numberValue(body.monthlyTotalSessions),
    monthlySwimmingSessions: numberValue(body.monthlySwimmingSessions),
    monthlySportSessions: numberValue(body.monthlySportSessions),
    monthlyFee: numberValue(body.monthlyFee),
    registrationDate: body.registrationDate || today(),
    note: nullableText(body.note),
    lessons: Array.isArray(body.lessons)
      ? body.lessons.slice(0, 4).map((lesson) => ({
        ...lesson,
        time: normalizeLessonTime(lesson?.time)
      })).filter((lesson) => lesson.time)
      : []
  };
}

function mapStudent(row, user = null) {
  const student = {
    id: row.id,
    status: row.status,
    fullName: row.full_name,
    program: row.program,
    level: row.level,
    packageCode: row.package_code,
    packageName: row.package_name,
    parentName: row.parent_name,
    phone: row.phone,
    socialMediaPermission: row.social_media_permission,
    monthlyTotalSessions: row.monthly_total_sessions,
    monthlySwimmingSessions: row.monthly_swimming_sessions,
    monthlySportSessions: row.monthly_sport_sessions,
    monthlyFee: Number(row.monthly_fee || 0),
    registrationDate: row.registration_date,
    passiveDate: row.passive_date,
    note: row.note,
    lessons: row.lessons || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (isCoach(user)) {
    delete student.packageCode;
    delete student.packageName;
    delete student.monthlyTotalSessions;
    delete student.monthlySwimmingSessions;
    delete student.monthlySportSessions;
    delete student.monthlyFee;
  }
  return student;
}

function mapPayment(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    periodMonth: row.period_month,
    monthlyFee: Number(row.monthly_fee || 0),
    paidAmount: Number(row.paid_amount || 0),
    remainingAmount: Math.max(0, Number(row.monthly_fee || 0) - Number(row.paid_amount || 0)),
    paymentDate: row.payment_date,
    method: row.method,
    description: row.description,
    createdAt: row.created_at
  };
}

function mapAttendance(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    lessonDate: row.lesson_date,
    dayOfWeek: row.day_of_week,
    startTime: normalizeLessonTime(row.start_time) || row.start_time,
    status: row.status,
    note: row.note,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const IMPORT_COLUMN_ALIASES = {
  fullName: ["ad_soyad", "ogrenci_adi", "adsoyad", "name", "full_name", "fullname"],
  parentName: ["veli_adi", "veli", "parent_name", "parentname"],
  phone: ["telefon", "veli_telefon", "phone"],
  program: ["brans", "program", "ders", "branch"],
  level: ["seviye", "level"],
  day: ["gun", "ders_gunu", "day"],
  time: ["saat", "ders_saati", "time"],
  monthlyFee: ["aylik_ucret", "ucret", "fee", "monthly_fee", "monthlyfee"],
  status: ["durum", "status"],
  note: ["not", "aciklama", "notes"]
};

function normalizeImportHeader(value) {
  return String(value || "")
    .trim()
    .replace(/[ıİ]/g, "i")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[şŞ]/g, "s")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function importCell(row, aliases) {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeImportHeader(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function normalizeImportStatus(value) {
  const text = normalizeImportHeader(value);
  if (["pasif", "passive", "inactive"].includes(text)) return "Pasif";
  if (["bekleyen", "waiting", "pending"].includes(text)) return "Bekleyen";
  return "Aktif";
}

function normalizeImportedStudent(row, rowNumber) {
  const monthlyFeeRaw = importCell(row, IMPORT_COLUMN_ALIASES.monthlyFee);
  const monthlyFee = Number(String(monthlyFeeRaw).replace(/\./g, "").replace(",", "."));
  const normalized = {
    rowNumber,
    fullName: importCell(row, IMPORT_COLUMN_ALIASES.fullName),
    parentName: importCell(row, IMPORT_COLUMN_ALIASES.parentName),
    phone: importCell(row, IMPORT_COLUMN_ALIASES.phone),
    program: importCell(row, IMPORT_COLUMN_ALIASES.program) || "Yüzme",
    level: importCell(row, IMPORT_COLUMN_ALIASES.level) || "Başlangıç",
    day: importCell(row, IMPORT_COLUMN_ALIASES.day),
    time: importCell(row, IMPORT_COLUMN_ALIASES.time),
    monthlyFee: Number.isFinite(monthlyFee) && monthlyFee > 0 ? monthlyFee : 0,
    status: normalizeImportStatus(importCell(row, IMPORT_COLUMN_ALIASES.status)),
    note: importCell(row, IMPORT_COLUMN_ALIASES.note)
  };
  const errors = [];
  if (!normalized.fullName) errors.push("Ogrenci adi zorunludur.");
  if (monthlyFeeRaw && !Number.isFinite(monthlyFee)) errors.push("Ucret sayisal olmalidir.");
  return { ...normalized, errors };
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value.trim());
  return values;
}

function rowsFromCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = parseCsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

async function rowsFromSpreadsheet(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (extension === ".csv") return rowsFromCsv(file.buffer);
  const matrix = await readXlsxFile(file.buffer);
  if (!matrix.length) return [];
  const headers = matrix[0].map((value) => String(value || "").trim());
  return matrix.slice(1).map((values) => (
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  ));
}

async function existingStudentKeys(client, clubId) {
  const { rows } = await client.query(
    "SELECT full_name, phone FROM students WHERE club_id = $1",
    [clubId]
  );
  return {
    byName: new Set(rows.map((row) => normalizeImportHeader(row.full_name))),
    byNamePhone: new Set(rows.map((row) => `${normalizeImportHeader(row.full_name)}|${String(row.phone || "").replace(/\D/g, "")}`))
  };
}

function isDuplicateImport(student, keys) {
  const nameKey = normalizeImportHeader(student.fullName);
  const phoneKey = String(student.phone || "").replace(/\D/g, "");
  if (phoneKey && keys.byNamePhone.has(`${nameKey}|${phoneKey}`)) return true;
  return keys.byName.has(nameKey);
}

async function previewImportedStudents(client, clubId, rawRows) {
  const keys = await existingStudentKeys(client, clubId);
  const seen = new Set();
  const rows = rawRows.map((row, index) => {
    const student = normalizeImportedStudent(row, index + 2);
    const nameKey = normalizeImportHeader(student.fullName);
    const phoneKey = String(student.phone || "").replace(/\D/g, "");
    const localKey = `${nameKey}|${phoneKey}`;
    const duplicate = !student.errors.length && (isDuplicateImport(student, keys) || seen.has(localKey));
    if (!student.errors.length) seen.add(localKey);
    return {
      ...student,
      duplicate,
      ready: !student.errors.length && !duplicate
    };
  });
  return {
    rows,
    summary: {
      readRows: rawRows.length,
      readyRows: rows.filter((row) => row.ready).length,
      duplicateRows: rows.filter((row) => row.duplicate).length,
      errorRows: rows.filter((row) => row.errors.length).length
    }
  };
}

async function audit(client, request, action, entityType, entityId, beforeData, afterData) {
  const clubId = beforeData?.club_id || beforeData?.clubId || afterData?.club_id || afterData?.clubId || getUserClubId(request.user);
  await client.query(
    `INSERT INTO audit_logs
      (club_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      clubId || null,
      request.user?.id || null,
      action,
      entityType,
      entityId ? String(entityId) : null,
      beforeData || null,
      afterData || null,
      requestIp(request)
    ]
  );
}

async function fetchStudent(client, id, user) {
  const params = [id];
  const filters = ["s.id = $1"];
  addStudentAccessFilter(filters, params, user, "s");
  const lessonJoin = "LEFT JOIN student_lessons l ON l.student_id = s.id";
  const { rows } = await client.query(
    `SELECT
       s.*,
       COALESCE(
         json_agg(
           json_build_object('id', l.id, 'day', l.day_of_week, 'time', ${lessonTimeSql("l")})
           ORDER BY l.id
         ) FILTER (WHERE l.id IS NOT NULL),
         '[]'
       ) AS lessons
     FROM students s
     ${lessonJoin}
     ${whereClause(filters)}
     GROUP BY s.id`,
    params
  );
  return rows[0] ? mapStudent(rows[0], user) : null;
}

async function replaceLessons(client, studentId, lessons, studentContext, trainerUserId = null) {
  const clubId = studentContext?.club_id || null;
  const branchId = studentContext?.branch_id || null;
  if (!clubId) return;
  await client.query("DELETE FROM student_lessons WHERE student_id = $1 AND club_id = $2", [studentId, clubId]);
  for (const lesson of lessons) {
    const day = nullableText(lesson.day);
    const time = normalizeLessonTime(lesson.time);
    if (!day || !time) continue;
    await client.query(
      `INSERT INTO student_lessons (student_id, club_id, branch_id, day_of_week, start_time, trainer_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [studentId, clubId, branchId, day, time, trainerUserId]
    );
  }
}

async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "Degistir123!");
  if (!password) {
    throw new Error("Ilk admin hesabi icin ADMIN_PASSWORD ortam degiskeni ayarlanmalidir.");
  }

  const { rows } = await query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0].count > 0) return;

  const passwordHash = await hashPassword(password);
  const clubId = await defaultClubId();
  await query(
    `INSERT INTO users (username, full_name, role, password_hash, club_id)
     VALUES ($1, $2, 'admin', $3, $4)`,
    [username, "EMBA Admin", passwordHash, clubId]
  );
  console.log(`Ilk admin kullanicisi olusturuldu: ${username}`);
}

app.get("/healthz", (_request, response) => {
  response.json({ ok: true, app: "kulupasist" });
});

app.post(
  "/api/auth/login",
  asyncHandler(async (request, response) => {
    const username = String(request.body.username || "").trim();
    const password = String(request.body.password || "");
    const { rows } = await query("SELECT * FROM users WHERE username = $1 AND active = TRUE", [username]);
    const user = rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      response.status(401).json({ error: "Kullanici adi veya sifre hatali." });
      return;
    }

    const token = makeSessionToken();
    await query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [cryptoRandomId(), user.id, tokenHash(token), sessionExpiresAt()]
    );
    setSessionCookie(response, token, request);
    response.json({ user: publicUser(user) });
  })
);

app.post(
  "/api/auth/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(request.sessionToken)]);
    clearSessionCookie(response, request);
    response.json({ ok: true });
  })
);

app.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    response.json({ user: publicUser(request.user) });
  })
);

app.get(
  "/api/clubs",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (!isSuperAdmin(request.user)) {
      response.status(403).json({ error: "Kulup listesi yalnizca ust yonetim icin aciktir." });
      return;
    }
    const { rows } = await query(
      `SELECT
         c.*,
         COALESCE(s.student_count, 0)::int AS student_count,
         COALESCE(s.active_student_count, 0)::int AS active_student_count,
         COALESCE(u.user_count, 0)::int AS user_count
       FROM clubs c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS student_count,
           COUNT(*) FILTER (WHERE status = 'Aktif')::int AS active_student_count
         FROM students
         WHERE club_id = c.id
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS user_count
         FROM users
         WHERE club_id = c.id
       ) u ON TRUE
       ORDER BY CASE WHEN c.slug = 'emba' THEN 0 ELSE 1 END, lower(c.name) ASC`
    );
    const clubs = rows.map(mapClub);
    response.json({
      clubs,
      totals: {
        clubCount: clubs.length,
        activeClubCount: clubs.filter((club) => club.status === "active").length,
        passiveClubCount: clubs.filter((club) => club.status !== "active").length,
        studentCount: clubs.reduce((sum, club) => sum + club.studentCount, 0),
        activeStudentCount: clubs.reduce((sum, club) => sum + club.activeStudentCount, 0),
        userCount: clubs.reduce((sum, club) => sum + club.userCount, 0)
      }
    });
  })
);

app.get(
  "/api/clubs/:id/summary",
  requireAuth,
  asyncHandler(async (request, response) => {
    const clubId = Number(request.params.id);
    if (!Number.isInteger(clubId) || clubId < 1) {
      response.status(400).json({ error: "Gecerli kulup secilmelidir." });
      return;
    }
    if (!isSuperAdmin(request.user) && Number(getUserClubId(request.user)) !== clubId) {
      response.status(403).json({ error: "Bu kulup icin yetkiniz yok." });
      return;
    }
    const { rows } = await query(
      `SELECT
         c.*,
         COALESCE(s.student_count, 0)::int AS student_count,
         COALESCE(s.active_student_count, 0)::int AS active_student_count,
         COALESCE(u.user_count, 0)::int AS user_count,
         COALESCE(p.current_month_paid, 0)::numeric AS current_month_paid,
         COALESCE(d.current_month_debt, 0)::numeric AS current_month_debt
       FROM clubs c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS student_count,
           COUNT(*) FILTER (WHERE status = 'Aktif')::int AS active_student_count
         FROM students
         WHERE club_id = c.id
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS user_count
         FROM users
         WHERE club_id = c.id
       ) u ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(paid_amount), 0)::numeric AS current_month_paid
         FROM payments
         WHERE club_id = c.id
           AND period_month = date_trunc('month', CURRENT_DATE)::date
       ) p ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(GREATEST(students.monthly_fee - COALESCE(paid.paid_amount, 0), 0)), 0)::numeric AS current_month_debt
         FROM students
         LEFT JOIN (
           SELECT student_id, SUM(paid_amount) AS paid_amount
           FROM payments
           WHERE club_id = c.id
             AND period_month = date_trunc('month', CURRENT_DATE)::date
           GROUP BY student_id
         ) paid ON paid.student_id = students.id
         WHERE students.club_id = c.id
           AND students.status = 'Aktif'
       ) d ON TRUE
       WHERE c.id = $1`,
      [clubId]
    );
    if (!rows[0]) {
      response.status(404).json({ error: "Kulup bulunamadi." });
      return;
    }
    response.json({ club: mapClub(rows[0]) });
  })
);

app.post(
  "/api/clubs",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (!isSuperAdmin(request.user)) {
      response.status(403).json({ error: "Kulup ekleme yalnizca ust yonetim icin aciktir." });
      return;
    }
    const payload = clubPayload(request.body || {});
    if (!payload.name || !payload.slug) {
      response.status(400).json({ error: "Kulup adi ve slug zorunludur." });
      return;
    }
    const userPayload = optionalClubUserPayload(request.body || {});
    if (userPayload) {
      if (!userPayload.role) {
        response.status(400).json({ error: "Gecerli bir kullanici rolu secilmelidir." });
        return;
      }
      if (!userPayload.username || !userPayload.fullName || userPayload.password.length < 8) {
        response.status(400).json({ error: "Yonetici kullanici adi, ad soyad ve en az 8 karakter gecici sifre gerekir." });
        return;
      }
      if (userPayload.passwordConfirm !== undefined && userPayload.password !== String(userPayload.passwordConfirm)) {
        response.status(400).json({ error: "Yönetici şifreleri eşleşmiyor." });
        return;
      }
    }

    const result = await transaction(async (client) => {
      const usernameExists = userPayload
        ? await client.query("SELECT id FROM users WHERE username = $1", [userPayload.username])
        : { rows: [] };
      if (usernameExists.rows[0]) {
        const error = new Error("Bu kullanici adi zaten kullaniliyor.");
        error.status = 409;
        throw error;
      }

      const createdClub = await client.query(
        `INSERT INTO clubs (name, slug, logo_url, phone, email, city, district, address, status, plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          payload.name,
          payload.slug,
          payload.logoUrl,
          payload.phone,
          payload.email,
          payload.city,
          payload.district,
          payload.address,
          payload.status,
          payload.plan
        ]
      );
      const club = createdClub.rows[0];
      await client.query(
        `INSERT INTO branches (club_id, name, type, active)
         VALUES ($1, $2, 'branch', TRUE)
         ON CONFLICT (club_id, name) DO NOTHING`,
        [club.id, "Ana Şube / Ana Salon"]
      );

      let createdUser = null;
      if (userPayload) {
        const userResult = await client.query(
          `INSERT INTO users (username, full_name, role, password_hash, club_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
          [
            userPayload.username,
            userPayload.fullName,
            userPayload.role,
            await hashPassword(userPayload.password),
            club.id
          ]
        );
        createdUser = publicUser(userResult.rows[0]);
      }

      return { club: mapClub(club), user: createdUser };
    });

    response.status(201).json(result);
  })
);

app.put(
  "/api/clubs/:id",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (!isSuperAdmin(request.user)) {
      response.status(403).json({ error: "Kulup duzenleme yalnizca ust yonetim icin aciktir." });
      return;
    }
    const payload = clubPayload(request.body || {});
    if (!payload.name || !payload.slug) {
      response.status(400).json({ error: "Kulup adi ve slug zorunludur." });
      return;
    }
    const { rows } = await query(
      `UPDATE clubs SET
         name = $1,
         slug = $2,
         logo_url = $3,
         phone = $4,
         email = $5,
         city = $6,
         district = $7,
         address = $8,
         status = $9,
         plan = $10
       WHERE id = $11
       RETURNING *`,
      [
        payload.name,
        payload.slug,
        payload.logoUrl,
        payload.phone,
        payload.email,
        payload.city,
        payload.district,
        payload.address,
        payload.status,
        payload.plan,
        request.params.id
      ]
    );
    if (!rows[0]) {
      response.status(404).json({ error: "Kulup bulunamadi." });
      return;
    }
    response.json({ club: mapClub(rows[0]) });
  })
);

app.post(
  "/api/clubs/:id/users",
  requireAuth,
  requirePermission("users:write"),
  asyncHandler(async (request, response) => {
    if (!isSuperAdmin(request.user)) {
      response.status(403).json({ error: "Kulup kullanicisi ekleme yalnizca ust yonetim icin aciktir." });
      return;
    }
    const username = nullableText(request.body.username);
    const fullName = nullableText(request.body.fullName);
    const role = normalizeCreatableRole(request.body.role, request.user);
    const password = String(request.body.password || "");
    if (!role) {
      response.status(403).json({ error: "Bu rol icin yetkiniz yok." });
      return;
    }
    if (!username || !fullName || password.length < 8) {
      response.status(400).json({ error: "Kullanici adi, ad soyad ve en az 8 karakter sifre gerekir." });
      return;
    }
    const clubId = Number(request.params.id);
    const club = await query("SELECT id FROM clubs WHERE id = $1", [clubId]);
    if (!club.rows[0]) {
      response.status(404).json({ error: "Kulup bulunamadi." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (username, full_name, role, password_hash, club_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
      [username, fullName, role, passwordHash, clubId]
    );
    response.status(201).json({ user: publicUser(rows[0]) });
  })
);

app.get(
  "/api/import/students/template.csv",
  requireAuth,
  requirePermission("students:import"),
  (_request, response) => {
    const headers = [
      "ad_soyad",
      "veli_adı",
      "telefon",
      "program",
      "seviye",
      "gün",
      "saat",
      "aylık_ücret",
      "durum",
      "not"
    ];
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", "attachment; filename=\"kulupasist-ogrenci-import-sablonu.csv\"");
    response.send(`${headers.join(";")}\n`);
  }
);

app.post(
  "/api/import/students/preview",
  requireAuth,
  requirePermission("students:import"),
  requireSelectedClubForSuperAdmin,
  upload.single("file"),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      response.status(400).json({ error: "Excel dosyasi yuklenmelidir." });
      return;
    }
    const clubId = isSuperAdmin(request.user) ? request.user.selectedClubId : getUserClubId(request.user);
    if (!clubId) {
      response.status(400).json({ error: "Kulup baglantisi bulunamadi." });
      return;
    }
    const rawRows = await rowsFromSpreadsheet(request.file);
    const client = await pool.connect();
    try {
      const preview = await previewImportedStudents(client, clubId, rawRows);
      response.json({
        ...preview,
        paymentImport: {
          supported: false,
          note: "Bu asamada odeme importu yazilmaz; ogrenci ve ders aktarimi onayla/commit ile yapilir."
        }
      });
    } finally {
      client.release();
    }
  })
);

app.post(
  "/api/import/students/commit",
  requireAuth,
  requirePermission("students:import"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const clubId = isSuperAdmin(request.user) ? request.user.selectedClubId : getUserClubId(request.user);
    if (!clubId) {
      response.status(400).json({ error: "Kulup baglantisi bulunamadi." });
      return;
    }
    const rows = Array.isArray(request.body.rows) ? request.body.rows.slice(0, 1000) : [];
    if (!rows.length) {
      response.status(400).json({ error: "Aktarilacak onayli satir bulunamadi." });
      return;
    }

    const result = await transaction(async (client) => {
      const branchId = await ensureDefaultBranchId(client, clubId);
      const preview = await previewImportedStudents(client, clubId, rows);
      const report = {
        readRows: rows.length,
        insertedStudents: 0,
        insertedLessons: 0,
        skippedDuplicates: 0,
        skippedErrors: 0,
        insertedPayments: 0,
        errors: []
      };

      for (const row of preview.rows) {
        if (row.errors.length) {
          report.skippedErrors += 1;
          report.errors.push({ rowNumber: row.rowNumber, fullName: row.fullName, errors: row.errors });
          continue;
        }
        if (row.duplicate) {
          report.skippedDuplicates += 1;
          continue;
        }

        const inserted = await client.query(
          `INSERT INTO students (
             status, full_name, program, level, parent_name, phone,
             monthly_fee, registration_date, note, created_by, updated_by, club_id, branch_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $9, $10, $11)
           RETURNING id, club_id, branch_id, full_name`,
          [
            row.status,
            row.fullName,
            row.program,
            row.level,
            row.parentName || null,
            row.phone || null,
            row.monthlyFee,
            row.note || null,
            request.user.id,
            clubId,
            branchId
          ]
        );
        report.insertedStudents += 1;

        if (row.day && row.time) {
          await client.query(
            `INSERT INTO student_lessons (student_id, club_id, branch_id, day_of_week, start_time)
             VALUES ($1, $2, $3, $4, $5)`,
            [inserted.rows[0].id, clubId, branchId, row.day, row.time]
          );
          report.insertedLessons += 1;
        }
      }

      return report;
    });

    response.status(201).json({
      report: result,
      paymentImport: {
        supported: false,
        insertedPayments: 0,
        note: "Odeme importu bu asamada yazilmadi; finans aktarimi ayri preview/onay asamasina birakildi."
      }
    });
  })
);

app.get(
  "/api/settings",
  requireAuth,
  requirePermission("dashboard:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    if (isCoach(request.user)) {
      response.status(403).json({ error: "Coach rolu kulup ayarlarina erisemez." });
      return;
    }
    const params = ["club"];
    const filters = ["key = $1"];
    addTenantFilter(filters, params, request.user, "app_settings");
    const { rows } = await query(
      `SELECT value
       FROM app_settings
       ${whereClause(filters)}
       ORDER BY club_id NULLS LAST
       LIMIT 1`,
      params
    );
    response.json(rows[0]?.value || {});
  })
);

app.get(
  "/api/dashboard",
  requireAuth,
  requirePermission("dashboard:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const period = normalizePeriodMonth(new Date().toISOString().slice(0, 7));
    const studentParams = [];
    const studentFilters = [];
    addStudentAccessFilter(studentFilters, studentParams, request.user, "s");
    const studentWhere = whereClause(studentFilters);
    const attendanceParams = [];
    const attendanceFilters = ["a.lesson_date >= CURRENT_DATE - INTERVAL '30 days'"];
    addAttendanceAccessFilter(attendanceFilters, attendanceParams, request.user, "a");
    const attendanceWhere = whereClause(attendanceFilters);
    const canReadFinance = can(request.user, "payments:read");
    const paymentPeriodParams = [period];
    let paymentPeriodWhere = "WHERE period_month = $1";
    const paymentTenantParams = [];
    let paymentTenantWhere = "";
    const debtParams = [period];
    let debtPaymentWhere = "WHERE period_month = $1";
    let debtStudentWhere = "WHERE s.status = 'Aktif'";
    const scopedClubId = isSuperAdmin(request.user) ? request.user.selectedClubId : getUserClubId(request.user);
    if (scopedClubId) {
      paymentPeriodParams.push(scopedClubId);
      paymentPeriodWhere += ` AND club_id = $${paymentPeriodParams.length}`;
      paymentTenantParams.push(scopedClubId);
      paymentTenantWhere = `WHERE club_id = $${paymentTenantParams.length}`;
      debtParams.push(scopedClubId);
      debtPaymentWhere += ` AND club_id = $${debtParams.length}`;
      debtStudentWhere += ` AND s.club_id = $${debtParams.length}`;
    }

    const [students, currentPayments, currentDebt, monthlyRevenue, attendance] = await Promise.all([
      query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Aktif')::int AS active,
          COUNT(*) FILTER (WHERE status = 'Bekleyen')::int AS waiting,
          COUNT(*) FILTER (WHERE status = 'Pasif')::int AS passive
        FROM students s
        ${studentWhere}`,
        studentParams
      ),
      canReadFinance
        ? query(`SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total FROM payments ${paymentPeriodWhere}`, paymentPeriodParams)
        : Promise.resolve({ rows: [{ total: 0 }] }),
      canReadFinance
        ? query(
            `SELECT COALESCE(SUM(GREATEST(s.monthly_fee - COALESCE(p.paid, 0), 0)), 0)::numeric AS total
             FROM students s
             LEFT JOIN (
               SELECT student_id, SUM(paid_amount) AS paid
               FROM payments
               ${debtPaymentWhere}
               GROUP BY student_id
             ) p ON p.student_id = s.id
             ${debtStudentWhere}`,
            debtParams
          )
        : Promise.resolve({ rows: [{ total: 0 }] }),
      canReadFinance
        ? query(
            `SELECT to_char(period_month, 'YYYY-MM') AS month, COALESCE(SUM(paid_amount), 0)::numeric AS total
             FROM payments
             ${paymentTenantWhere}
             GROUP BY period_month
             ORDER BY period_month DESC
             LIMIT 12`,
            paymentTenantParams
          )
        : Promise.resolve({ rows: [] }),
      query(
        `SELECT status, COUNT(*)::int AS total
         FROM attendance_records a
         ${attendanceWhere}
         GROUP BY status`
        ,
        attendanceParams
      )
    ]);

    response.json({
      students: students.rows[0],
      currentMonthPaid: Number(currentPayments.rows[0].total || 0),
      currentMonthDebt: Number(currentDebt.rows[0].total || 0),
      monthlyRevenue: monthlyRevenue.rows.map((row) => ({ month: row.month, total: Number(row.total || 0) })).reverse(),
      attendance: attendance.rows
    });
  })
);

app.get(
  "/api/students",
  requireAuth,
  requirePermission("students:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const search = String(request.query.q || "").trim();
    const status = String(request.query.status || "").trim();
    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLocaleLowerCase("tr-TR")}%`);
      filters.push(`lower(s.full_name) LIKE $${params.length}`);
    }
    if (isCoach(request.user)) {
      params.push("Aktif");
      filters.push(`s.status = $${params.length}`);
    } else if (status && status !== "all") {
      params.push(status);
      filters.push(`s.status = $${params.length}`);
    }
    const activeOn = request.query.activeOn === undefined ? null : validDateOrNull(request.query.activeOn);
    if (activeOn === undefined) throw httpError("Gecersiz aktiflik tarihi.", 400);
    if (activeOn) {
      params.push(activeOn);
      filters.push(passiveEligibilitySql("s", `$${params.length}`));
    }

    addStudentAccessFilter(filters, params, request.user, "s");
    const lessonJoin = "LEFT JOIN student_lessons l ON l.student_id = s.id";
    const where = whereClause(filters);
    const { rows } = await query(
      `SELECT
         s.*,
         COALESCE(
           json_agg(
             json_build_object('id', l.id, 'day', l.day_of_week, 'time', ${lessonTimeSql("l")})
             ORDER BY l.id
           ) FILTER (WHERE l.id IS NOT NULL),
           '[]'
         ) AS lessons
       FROM students s
       ${lessonJoin}
       ${where}
       GROUP BY s.id
       ORDER BY lower(s.full_name) ASC
       LIMIT 500`,
      params
    );
    response.json({ students: rows.map((row) => mapStudent(row, request.user)) });
  })
);

app.post(
  "/api/students",
  requireAuth,
  requirePermission("students:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const payload = studentPayload(request.body);
    if (isCoach(request.user)) {
      payload.packageCode = null;
      payload.packageName = null;
      payload.monthlyTotalSessions = 0;
      payload.monthlySwimmingSessions = 0;
      payload.monthlySportSessions = 0;
      payload.monthlyFee = 0;
    }
    if (!payload.fullName) {
      response.status(400).json({ error: "Ogrenci adi zorunludur." });
      return;
    }

    const student = await transaction(async (client) => {
      const clubId = await resolveWriteClubId(client, request);
      const branchId = await resolveWriteBranchId(client, request, clubId);
      if (!clubId) {
        const error = new Error("Kulup baglantisi bulunamadi.");
        error.status = 400;
        throw error;
      }
      const duplicateParams = [clubId, payload.fullName];
      let duplicateWhere = "club_id = $1 AND lower(full_name) = lower($2) AND status <> 'Pasif'";
      if (payload.phone) {
        duplicateParams.push(payload.phone);
        duplicateWhere += ` AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = regexp_replace($${duplicateParams.length}, '\\D', '', 'g')`;
      } else {
        duplicateWhere += " AND COALESCE(NULLIF(trim(phone), ''), '') = ''";
      }
      const duplicate = await client.query(
        `SELECT id FROM students WHERE ${duplicateWhere} LIMIT 1`,
        duplicateParams
      );
      if (duplicate.rows[0]) {
        const error = new Error("Bu öğrenci zaten kayıtlı görünüyor.");
        error.status = 409;
        throw error;
      }
      const { rows } = await client.query(
        `INSERT INTO students (
          status, full_name, program, level, package_code, package_name, parent_name, phone,
          social_media_permission, monthly_total_sessions, monthly_swimming_sessions,
          monthly_sport_sessions, monthly_fee, registration_date, passive_date, note, created_by, updated_by,
          club_id, branch_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, $18, $19)
        RETURNING id, club_id, branch_id`,
        [
          payload.status,
          payload.fullName,
          payload.program,
          payload.level,
          payload.packageCode,
          payload.packageName,
          payload.parentName,
          payload.phone,
          payload.socialMediaPermission,
          payload.monthlyTotalSessions,
          payload.monthlySwimmingSessions,
          payload.monthlySportSessions,
          payload.monthlyFee,
          payload.registrationDate,
          payload.passiveDate,
          payload.note,
          request.user.id,
          clubId,
          branchId
        ]
      );
      await replaceLessons(client, rows[0].id, payload.lessons, rows[0], isCoach(request.user) ? request.user.id : null);
      const created = await fetchStudent(client, rows[0].id, request.user);
      await audit(client, request, "create", "student", rows[0].id, null, created);
      return created;
    });

    response.status(201).json({ student });
  })
);

app.patch(
  "/api/students/:id",
  requireAuth,
  requirePermission("students:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    if (isCoach(request.user)) {
      response.status(403).json({ error: "Coach yalnizca yeni ogrenci ekleyebilir; duzenleme yetkisi manager tarafindadir." });
      return;
    }
    const payload = studentPayload(request.body);
    if (!payload.fullName) {
      response.status(400).json({ error: "Ogrenci adi zorunludur." });
      return;
    }

    const student = await transaction(async (client) => {
      const studentMeta = await fetchAccessibleStudentMeta(client, request.user, request.params.id);
      if (!studentMeta) return null;
      const before = await fetchStudent(client, request.params.id, request.user);
      await client.query(
        `UPDATE students SET
          status = $1,
          full_name = $2,
          program = $3,
          level = $4,
          package_code = $5,
          package_name = $6,
          parent_name = $7,
          phone = $8,
          social_media_permission = $9,
          monthly_total_sessions = $10,
          monthly_swimming_sessions = $11,
          monthly_sport_sessions = $12,
          monthly_fee = $13,
          registration_date = $14,
          passive_date = $15,
          note = $16,
          updated_by = $17
         WHERE id = $18 AND club_id = $19`,
        [
          payload.status,
          payload.fullName,
          payload.program,
          payload.level,
          payload.packageCode,
          payload.packageName,
          payload.parentName,
          payload.phone,
          payload.socialMediaPermission,
          payload.monthlyTotalSessions,
          payload.monthlySwimmingSessions,
          payload.monthlySportSessions,
          payload.monthlyFee,
          payload.registrationDate,
          payload.passiveDate,
          payload.note,
          request.user.id,
          request.params.id,
          studentMeta.club_id
        ]
      );
      await replaceLessons(client, request.params.id, payload.lessons, studentMeta);
      const updated = await fetchStudent(client, request.params.id, request.user);
      await audit(client, request, "update", "student", request.params.id, before, updated);
      return updated;
    });

    if (!student) {
      response.status(404).json({ error: "Ogrenci bulunamadi." });
      return;
    }
    response.json({ student });
  })
);

app.delete(
  "/api/students/:id",
  requireAuth,
  requirePermission("students:delete"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    await transaction(async (client) => {
      const studentMeta = await fetchAccessibleStudentMeta(client, request.user, request.params.id);
      if (!studentMeta) return;
      const before = await fetchStudent(client, request.params.id, request.user);
      await client.query("DELETE FROM students WHERE id = $1 AND club_id = $2", [request.params.id, studentMeta.club_id]);
      await audit(client, request, "delete", "student", request.params.id, before, null);
    });
    response.json({ ok: true });
  })
);

app.get(
  "/api/students/:id",
  requireAuth,
  requirePermission("students:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const client = await pool.connect();
    try {
      const student = await fetchStudent(client, request.params.id, request.user);
      if (!student) {
        response.status(404).json({ error: "Ogrenci bulunamadi." });
        return;
      }
      const paymentParams = [request.params.id];
      const paymentFilters = ["p.student_id = $1"];
      addTenantFilter(paymentFilters, paymentParams, request.user, "p");
      const attendanceParams = [request.params.id];
      const attendanceFilters = ["a.student_id = $1"];
      addAttendanceAccessFilter(attendanceFilters, attendanceParams, request.user, "a");
      const [payments, attendance] = await Promise.all([
        can(request.user, "payments:read")
          ? client.query(
              `SELECT p.*, s.full_name AS student_name
               FROM payments p
               JOIN students s ON s.id = p.student_id
               ${whereClause(paymentFilters)}
               ORDER BY p.period_month DESC, p.created_at DESC`,
              paymentParams
            )
          : Promise.resolve({ rows: [] }),
        client.query(
          `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
           FROM attendance_records a
           JOIN students s ON s.id = a.student_id
           LEFT JOIN users u ON u.id = a.recorded_by
           ${whereClause(attendanceFilters)}
           ORDER BY a.lesson_date DESC, a.start_time DESC`,
          attendanceParams
        )
      ]);
      const attendanceRows = attendance.rows.map(mapAttendance);
      const presentCount = attendanceRows.filter((item) => item.status === "present").length;
      const absentCount = attendanceRows.filter((item) => item.status === "absent").length;
      const totalAttendance = presentCount + absentCount;
      const lastAttendance = attendanceRows[0] || null;
      response.json({
        student,
        payments: payments.rows.map(mapPayment),
        attendance: attendanceRows,
        attendanceSummary: {
          present: presentCount,
          absent: absentCount,
          total: totalAttendance,
          attendanceRate: totalAttendance ? Math.round((presentCount / totalAttendance) * 100) : 0,
          lastDate: lastAttendance?.lessonDate || null
        }
      });
    } finally {
      client.release();
    }
  })
);

app.get(
  "/api/payments",
  requireAuth,
  requirePermission("payments:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const period = request.query.month ? normalizePeriodMonth(request.query.month) : null;
    const params = [];
    const filters = [];
    if (period) {
      params.push(period);
      filters.push(`p.period_month = $${params.length}`);
    }
    if (period) {
      filters.push(passiveEligibilitySql("s", `$${params.length}`));
    } else {
      filters.push("s.status = 'Aktif'");
    }
    addTenantFilter(filters, params, request.user, "p");
    const where = whereClause(filters);
    const { rows } = await query(
      `SELECT p.*, s.full_name AS student_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       ${where}
       ORDER BY p.period_month DESC, lower(s.full_name) ASC, p.created_at DESC
       LIMIT 600`,
      params
    );
    response.json({ payments: rows.map(mapPayment) });
  })
);

app.post(
  "/api/payments",
  requireAuth,
  requirePermission("payments:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const studentId = Number(request.body.studentId);
    const periodMonth = validPeriodMonth(request.body.periodMonth);
    const monthlyFee = nonNegativeAmount(request.body.monthlyFee, 0);
    let paidAmount = nonNegativeAmount(request.body.paidAmount, 0);
    const paymentDate = validDateOrNull(request.body.paymentDate || today());
    const status = String(request.body.status || "").trim();
    if (!Number.isInteger(studentId) || studentId <= 0) throw httpError("Gecerli ogrenci secilmelidir.", 400);
    if (!periodMonth) throw httpError("Gecersiz ay/donem.", 400);
    if (monthlyFee === null) throw httpError("Aylik ucret negatif veya gecersiz olamaz.", 400);
    if (paidAmount === null) throw httpError("Odeme tutari negatif veya gecersiz olamaz.", 400);
    if (paymentDate === undefined) throw httpError("Gecersiz odeme tarihi.", 400);
    if (status && !["paid", "partial", "unpaid"].includes(status)) throw httpError("Gecersiz odeme durumu.", 400);
    if (status === "paid") paidAmount = monthlyFee;
    if (status === "unpaid") paidAmount = 0;
    if (paidAmount > monthlyFee) paidAmount = monthlyFee;

    const payment = await transaction(async (client) => {
      const student = await fetchAccessibleStudentMeta(client, request.user, studentId);
      if (!student) {
        const error = new Error("Ogrenci bulunamadi.");
        error.status = 404;
        throw error;
      }
      if (!studentEligibleForDateSqlCheck(student, periodMonth)) {
        throw httpError("Bu ogrenci secilen odeme ayinda aktif listede degil.", 400);
      }
      const { rows } = await client.query(
        `INSERT INTO payments
          (student_id, club_id, branch_id, period_month, monthly_fee, paid_amount, payment_date, method, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          studentId,
          student.club_id,
          student.branch_id,
          periodMonth,
          monthlyFee,
          paidAmount,
          paymentDate || today(),
          nullableText(request.body.method),
          nullableText(request.body.description),
          request.user.id
        ]
      );
      await audit(client, request, "create", "payment", rows[0].id, null, rows[0]);
      return rows[0];
    });

    const { rows } = await query(
      `SELECT p.*, s.full_name AS student_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       WHERE p.id = $1 AND p.club_id = $2`,
      [payment.id, payment.club_id]
    );
    response.status(201).json({ payment: mapPayment(rows[0]) });
  })
);

app.patch(
  "/api/payments/:id",
  requireAuth,
  requirePermission("payments:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const paymentId = Number(request.params.id);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      throw httpError("Gecersiz odeme kaydi.", 400);
    }

    const updated = await transaction(async (client) => {
      const { payment: before, forbidden } = await fetchPaymentForWrite(client, request.user, paymentId);
      if (forbidden) throw httpError("Bu odeme kaydi icin yetkiniz yok.", 403);
      if (!before) throw httpError("Odeme kaydi bulunamadi.", 404);

      const periodMonth = request.body.periodMonth === undefined
        ? dateOnly(before.period_month)
        : validPeriodMonth(request.body.periodMonth);
      if (!periodMonth) throw httpError("Gecersiz ay/donem.", 400);

      const paymentDate = request.body.paymentDate === undefined
        ? (before.payment_date ? dateOnly(before.payment_date) : null)
        : validDateOrNull(request.body.paymentDate);
      if (paymentDate === undefined) throw httpError("Gecersiz odeme tarihi.", 400);

      const monthlyFee = nonNegativeAmount(request.body.monthlyFee, Number(before.monthly_fee || 0));
      if (monthlyFee === null) throw httpError("Aylik ucret negatif veya gecersiz olamaz.", 400);

      let paidAmount = nonNegativeAmount(request.body.paidAmount, Number(before.paid_amount || 0));
      if (paidAmount === null) throw httpError("Odeme tutari negatif veya gecersiz olamaz.", 400);

      const status = request.body.status === undefined ? null : String(request.body.status || "").trim();
      if (status && !["paid", "partial", "unpaid"].includes(status)) {
        throw httpError("Gecersiz odeme durumu.", 400);
      }
      if (status === "paid") paidAmount = monthlyFee;
      if (status === "unpaid") paidAmount = 0;
      if (paidAmount > monthlyFee) paidAmount = monthlyFee;

      const method = request.body.method === undefined ? before.method : nullableText(request.body.method);
      const description = request.body.description === undefined ? before.description : nullableText(request.body.description);

      const { rows } = await client.query(
        `UPDATE payments SET
           period_month = $1,
           monthly_fee = $2,
           paid_amount = $3,
           payment_date = $4,
           method = $5,
           description = $6
         WHERE id = $7 AND club_id = $8
         RETURNING *`,
        [
          periodMonth,
          monthlyFee,
          paidAmount,
          paymentDate,
          method,
          description,
          paymentId,
          before.club_id
        ]
      );
      await audit(client, request, "update", "payment", paymentId, before, rows[0]);
      return rows[0];
    });

    const { rows } = await query(
      `SELECT p.*, s.full_name AS student_name
       FROM payments p
       JOIN students s ON s.id = p.student_id
       WHERE p.id = $1 AND p.club_id = $2`,
      [updated.id, updated.club_id]
    );
    response.json({ payment: mapPayment(rows[0]) });
  })
);

app.delete(
  "/api/payments/:id",
  requireAuth,
  requirePermission("payments:delete"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    await transaction(async (client) => {
      const params = [request.params.id];
      const filters = ["id = $1"];
      addTenantFilter(filters, params, request.user, "payments");
      const { rows } = await client.query(`SELECT * FROM payments ${whereClause(filters)}`, params);
      if (!rows[0]) return;
      await client.query("DELETE FROM payments WHERE id = $1 AND club_id = $2", [request.params.id, rows[0].club_id]);
      await audit(client, request, "delete", "payment", request.params.id, rows[0], null);
    });
    response.json({ ok: true });
  })
);

app.get(
  "/api/attendance/slots",
  requireAuth,
  requirePermission("attendance:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = request.query.date || today();
    const dayOfWeek = dayNameForDate(lessonDate);
    const params = [dayOfWeek, lessonDate];
    const filters = ["lower(l.day_of_week) = lower($1)", passiveEligibilitySql("s", "$2")];
    addTenantFilter(filters, params, request.user, "s");
    const { rows } = await query(
      `SELECT ${lessonTimeSql("l")} AS start_time, COUNT(DISTINCT s.id)::int AS student_count
       FROM student_lessons l
       JOIN students s ON s.id = l.student_id
       ${whereClause(filters)}
       GROUP BY ${lessonTimeSql("l")}
       ORDER BY ${lessonTimeSql("l")} ASC`,
      params
    );
    response.json({
      date: lessonDate,
      dayOfWeek,
      slots: rows.map((row) => ({
        time: row.start_time,
        studentCount: Number(row.student_count || 0)
      }))
    });
  })
);

app.get(
  "/api/attendance/lesson-students",
  requireAuth,
  requirePermission("attendance:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = request.query.date || today();
    const startTime = normalizeLessonTime(request.query.time);
    if (!startTime) {
      response.status(400).json({ error: "Ders saati secilmelidir." });
      return;
    }
    const dayOfWeek = dayNameForDate(lessonDate);
    const params = [dayOfWeek, startTime, lessonDate];
    const filters = [
      `(
        (lower(l.day_of_week) = lower($1) AND ${lessonTimeSql("l")} = $2)
        OR a.id IS NOT NULL
      )`,
      passiveEligibilitySql("s", "$3")
    ];
    addTenantFilter(filters, params, request.user, "s");
    const { rows } = await query(
      `SELECT
         s.*,
         c.slug AS club_slug,
         COALESCE(
           json_agg(
             json_build_object('id', all_lessons.id, 'day', all_lessons.day_of_week, 'time', ${lessonTimeSql("all_lessons")})
             ORDER BY all_lessons.id
           ) FILTER (WHERE all_lessons.id IS NOT NULL),
           '[]'
         ) AS lessons,
         a.status AS attendance_status,
         a.note AS attendance_note,
         u.full_name AS recorded_by_name
       FROM students s
       LEFT JOIN clubs c ON c.id = s.club_id
       LEFT JOIN student_lessons all_lessons ON all_lessons.student_id = s.id
       LEFT JOIN student_lessons l ON l.student_id = s.id
       LEFT JOIN attendance_records a
         ON a.student_id = s.id
        AND a.lesson_date = $3
        AND ${lessonTimeSql("a")} = $2
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       GROUP BY s.id, c.slug, a.status, a.note, u.full_name
       ORDER BY lower(s.full_name) ASC`,
      params
    );
    response.json({
      date: lessonDate,
      dayOfWeek,
      time: startTime,
      students: rows.map((row) => ({
        ...mapStudent(row, request.user),
        attendanceStatus: row.attendance_status || null,
        attendanceNote: row.attendance_note || null,
        recordedByName: row.recorded_by_name || null
      }))
    });
  })
);

app.get(
  "/api/attendance/eligible-students",
  requireAuth,
  requirePermission("attendance:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = validDateOrNull(request.query.date || today());
    const startTime = normalizeLessonTime(request.query.time);
    const search = nullableText(request.query.search);
    if (!lessonDate || !startTime) {
      throw httpError("Tarih ve saat secilmelidir.", 400);
    }
    const dayOfWeek = dayNameForDate(lessonDate);
    const params = [lessonDate, startTime, dayOfWeek];
    const filters = [
      passiveEligibilitySql("s", "$1"),
      `NOT EXISTS (
        SELECT 1 FROM attendance_records a
        WHERE a.student_id = s.id
          AND a.lesson_date = $1
          AND ${lessonTimeSql("a")} = $2
      )`,
      `NOT EXISTS (
        SELECT 1 FROM student_lessons l
        WHERE l.student_id = s.id
          AND lower(l.day_of_week) = lower($3)
          AND ${lessonTimeSql("l")} = $2
      )`
    ];
    if (search) {
      params.push(`%${search.toLocaleLowerCase("tr-TR")}%`);
      filters.push(`lower(s.full_name) LIKE $${params.length}`);
    }
    addStudentAccessFilter(filters, params, request.user, "s");
    const { rows } = await query(
      `SELECT
         s.*,
         COALESCE(
           json_agg(
             json_build_object('id', all_lessons.id, 'day', all_lessons.day_of_week, 'time', ${lessonTimeSql("all_lessons")})
             ORDER BY all_lessons.id
           ) FILTER (WHERE all_lessons.id IS NOT NULL),
           '[]'
         ) AS lessons
       FROM students s
       LEFT JOIN student_lessons all_lessons ON all_lessons.student_id = s.id
       ${whereClause(filters)}
       GROUP BY s.id
       ORDER BY lower(s.full_name) ASC
       LIMIT 30`,
      params
    );
    response.json({ students: rows.map((row) => mapStudent(row, request.user)) });
  })
);

app.post(
  "/api/attendance/manual-student",
  requireAuth,
  requirePermission("attendance:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = validDateOrNull(request.body?.date || request.body?.lessonDate);
    const startTime = normalizeLessonTime(request.body?.time || request.body?.startTime);
    const studentId = Number(request.body?.studentId || request.body?.student_id);
    if (!lessonDate || !startTime || !Number.isInteger(studentId) || studentId <= 0) {
      throw httpError("Tarih, saat ve ogrenci secilmelidir.", 400);
    }
    const scopedClubId = isSuperAdmin(request.user) ? request.user.selectedClubId : getUserClubId(request.user);
    if (!scopedClubId) throw httpError("Bu kulup yoklamasi icin yetkiniz yok.", 403);
    const dayOfWeek = dayNameForDate(lessonDate);
    const result = await transaction(async (client) => {
      const studentResult = await client.query(
        `SELECT id, full_name, status, passive_date, club_id, branch_id
         FROM students
         WHERE id = $1
         LIMIT 1`,
        [studentId]
      );
      const student = studentResult.rows[0];
      if (!student) throw httpError("Ogrenci bulunamadi.", 404);
      if (String(student.club_id) !== String(scopedClubId)) {
        throw httpError("Bu kulube ait olmayan ogrenci eklenemez.", 403);
      }
      if (!studentEligibleForDateSqlCheck(student, lessonDate)) {
        throw httpError("Bu ogrenci secilen tarihte aktif yoklama listesine eklenemez.", 400);
      }
      const duplicate = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM attendance_records a
           WHERE a.student_id = $1
             AND a.lesson_date = $2
             AND ${lessonTimeSql("a")} = $3
         ) OR EXISTS (
           SELECT 1 FROM student_lessons l
           WHERE l.student_id = $1
             AND lower(l.day_of_week) = lower($4)
             AND ${lessonTimeSql("l")} = $3
         ) AS found`,
        [studentId, lessonDate, startTime, dayOfWeek]
      );
      if (duplicate.rows[0]?.found) {
        throw httpError("Bu ogrenci secili tarih/saat listesinde zaten var.", 409);
      }
      const inserted = await client.query(
        `INSERT INTO attendance_records
          (student_id, club_id, branch_id, lesson_date, day_of_week, start_time, status, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'blank', $7, $8)
         RETURNING id`,
        [
          student.id,
          student.club_id,
          student.branch_id,
          lessonDate,
          dayOfWeek,
          startTime,
          "Manuel yoklama listesine eklendi.",
          request.user.id
        ]
      );
      await audit(client, request, "manual_add", "attendance_record", inserted.rows[0].id, null, {
        club_id: student.club_id,
        student_id: student.id,
        lessonDate,
        startTime
      });
      return { recordId: inserted.rows[0].id };
    });
    response.status(201).json({ ok: true, ...result });
  })
);

app.post(
  "/api/attendance/bulk",
  requireAuth,
  requirePermission("attendance:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = request.body.lessonDate || today();
    const startTime = normalizeLessonTime(request.body.startTime);
    const records = Array.isArray(request.body.records) ? request.body.records : [];
    if (!startTime || !records.length) {
      response.status(400).json({ error: "Ders saati ve yoklama kayitlari zorunludur." });
      return;
    }
    const dayOfWeek = dayNameForDate(lessonDate);
    const result = await transaction(async (client) => {
      const clubId = isSuperAdmin(request.user) ? request.user.selectedClubId : getUserClubId(request.user);
      const ids = records.map((record) => Number(record.studentId)).filter((id) => Number.isInteger(id));
      const eligible = await client.query(
        `SELECT DISTINCT s.id, s.club_id, s.branch_id
         FROM students s
         LEFT JOIN student_lessons l ON l.student_id = s.id
         LEFT JOIN attendance_records a
           ON a.student_id = s.id
          AND a.lesson_date = $4
          AND ${lessonTimeSql("a")} = $3
         WHERE s.club_id = $1
           AND ${passiveEligibilitySql("s", "$4")}
           AND (
             (lower(l.day_of_week) = lower($2) AND ${lessonTimeSql("l")} = $3)
             OR a.id IS NOT NULL
           )
           AND s.id = ANY($5::bigint[])`,
        [clubId, dayOfWeek, startTime, lessonDate, ids]
      );
      const eligibleById = new Map(eligible.rows.map((row) => [String(row.id), row]));
      const report = { saved: 0, skipped: 0 };
      for (const record of records) {
        const student = eligibleById.get(String(record.studentId));
        if (!student) {
          report.skipped += 1;
          continue;
        }
        await client.query(
          `INSERT INTO attendance_records
            (student_id, club_id, branch_id, lesson_date, day_of_week, start_time, status, note, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (student_id, lesson_date, start_time)
           DO UPDATE SET
            day_of_week = EXCLUDED.day_of_week,
            club_id = EXCLUDED.club_id,
            branch_id = EXCLUDED.branch_id,
            status = EXCLUDED.status,
            note = EXCLUDED.note,
            recorded_by = EXCLUDED.recorded_by
           RETURNING id`,
          [
            student.id,
            student.club_id,
            student.branch_id,
            lessonDate,
            dayOfWeek,
            startTime,
            normalizeAttendanceStatus(record.status),
            nullableText(record.note),
            request.user.id
          ]
        );
        report.saved += 1;
      }
      return report;
    });
    response.status(201).json({ ok: true, ...result });
  })
);

app.post(
  "/api/attendance/clear",
  requireAuth,
  requirePermission("attendance:write"),
  asyncHandler(async (request, response) => {
    if (!canResetAttendanceSession(request.user)) {
      throw httpError("Yoklama temizleme yetkiniz yok.", 403);
    }
    if (!validAttendanceResetConfirm(request.body?.confirm)) {
      throw httpError("Yoklama temizleme icin TEMIZLE onayi gereklidir.", 400);
    }
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup yoklamasi icin yetkiniz yok.", 403);
    }
    const lessonDate = validDateOrNull(request.body?.date || request.body?.lessonDate);
    const startTime = normalizeLessonTime(request.body?.time || request.body?.startTime);
    const clubId = attendanceClearClubId(request);
    if (!lessonDate || !startTime) {
      throw httpError("Temizlenecek tarih ve saat secilmelidir.", 400);
    }
    if (!clubId) {
      throw httpError("Bu kulup yoklamasi icin yetkiniz yok.", 403);
    }
    const result = await transaction(async (client) => {
      const deleted = await client.query(
        `DELETE FROM attendance_records
         WHERE lesson_date = $1
           AND ${lessonTimeSql("attendance_records")} = $2
           AND club_id = $3
         RETURNING id`,
        [lessonDate, startTime, clubId]
      );
      await audit(
        client,
        request,
        "clear",
        "attendance_session",
        `${lessonDate}_${startTime}_${clubId}`,
        { club_id: clubId, lessonDate, startTime },
        { club_id: clubId, deletedRecordCount: deleted.rowCount }
      );
      return { deleted: deleted.rowCount, clubId, lessonDate, startTime };
    });
    response.json({ ok: true, ...result });
  })
);

app.get(
  "/api/reports/attendance-days",
  requireAuth,
  requirePermission("attendance:read"),
  asyncHandler(async (request, response) => {
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup raporu icin yetkiniz yok.", 403);
    }
    const lessonDate = request.query.date || today();
    const params = [lessonDate];
    const filters = ["a.lesson_date = $1"];
    const startTime = normalizeLessonTime(request.query.time);
    const status = nullableText(request.query.status);
    const coachId = Number(request.query.coachId || 0);
    if (startTime) {
      params.push(startTime);
      filters.push(`${lessonTimeSql("a")} = $${params.length}`);
    }
    if (status && status !== "all") {
      params.push(status);
      filters.push(`a.status = $${params.length}`);
    }
    if (!isCoach(request.user) && Number.isInteger(coachId) && coachId > 0) {
      params.push(coachId);
      filters.push(`a.recorded_by = $${params.length}`);
    }
    addReportAttendanceAccessFilter(filters, params, request, "a");
    const slotExpression = lessonTimeSql("a");
    const { rows } = await query(
      `SELECT
         a.lesson_date,
         MIN(a.day_of_week) AS day_of_week,
         ${slotExpression} AS start_time,
         a.club_id,
         c.name AS club_name,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE a.status = 'present')::int AS present_count,
         COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent_count,
         COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused_count,
         COUNT(*) FILTER (WHERE a.status NOT IN ('present', 'absent', 'excused'))::int AS other_count,
         string_agg(DISTINCT COALESCE(u.full_name, 'Sistem'), ', ') AS recorded_by_names,
         MAX(a.created_at) AS recorded_at,
         MAX(a.updated_at) AS updated_at
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN clubs c ON c.id = a.club_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       GROUP BY a.lesson_date, ${slotExpression}, a.club_id, c.name
       ORDER BY ${slotExpression} ASC`,
      params
    );
    const coachResult = await query(
      `SELECT DISTINCT a.recorded_by AS coach_id, COALESCE(u.full_name, 'Sistem') AS coach_name
       FROM attendance_records a
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY coach_name ASC`,
      params
    );
    const canEditRecords = can(request.user, "attendance:write");
    const canResetSession = canResetAttendanceSession(request.user);
    const isToday = String(lessonDate) === today();
    response.json({
      date: lessonDate,
      dayOfWeek: dayNameForDate(lessonDate),
      supportsCancellation: false,
      cancellationMigrationRequired: true,
      coaches: coachResult.rows.map((row) => ({
        id: row.coach_id,
        name: row.coach_name
      })),
      sessions: rows.map((row) => ({
        id: `${dateOnly(row.lesson_date)}_${row.start_time}_${row.club_id || "center"}`,
        lessonDate: row.lesson_date,
        dayOfWeek: row.day_of_week || dayNameForDate(row.lesson_date),
        startTime: row.start_time,
        clubId: row.club_id,
        clubName: row.club_name,
        total: Number(row.total_count || 0),
        present: Number(row.present_count || 0),
        absent: Number(row.absent_count || 0),
        excused: Number(row.excused_count || 0),
        other: Number(row.other_count || 0),
        recordedByName: row.recorded_by_names,
        recordedAt: row.recorded_at,
        updatedAt: row.updated_at,
        canEdit: canEditRecords && (!isCoach(request.user) || isToday),
        canReset: canResetSession,
        canCancel: false,
        cancellationMigrationRequired: true
      }))
    });
  })
);

app.get(
  "/api/reports/attendance-detail",
  requireAuth,
  requirePermission("attendance:read"),
  asyncHandler(async (request, response) => {
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup raporu icin yetkiniz yok.", 403);
    }
    const lessonDate = request.query.date || today();
    const startTime = normalizeLessonTime(request.query.time);
    if (!startTime) {
      response.status(400).json({ error: "Rapor detayi icin saat secilmelidir." });
      return;
    }
    const params = [lessonDate, startTime];
    const filters = ["a.lesson_date = $1", `${lessonTimeSql("a")} = $2`];
    const status = nullableText(request.query.status);
    const coachId = Number(request.query.coachId || 0);
    if (status && status !== "all") {
      params.push(status);
      filters.push(`a.status = $${params.length}`);
    }
    if (!isCoach(request.user) && Number.isInteger(coachId) && coachId > 0) {
      params.push(coachId);
      filters.push(`a.recorded_by = $${params.length}`);
    }
    addReportAttendanceAccessFilter(filters, params, request, "a");
    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, c.name AS club_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN clubs c ON c.id = a.club_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY lower(s.full_name) ASC`,
      params
    );
    const isToday = String(lessonDate) === today();
    response.json({
      date: lessonDate,
      time: startTime,
      canEdit: can(request.user, "attendance:write") && (!isCoach(request.user) || isToday),
      canReset: canResetAttendanceSession(request.user),
      canCancel: false,
      cancellationMigrationRequired: true,
      records: rows.map((row) => ({
        ...mapAttendance(row),
        clubName: row.club_name
      }))
    });
  })
);

app.get(
  "/api/reports/attendance-weekly",
  requireAuth,
  requirePermission("attendance:read"),
  asyncHandler(async (request, response) => {
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup raporu icin yetkiniz yok.", 403);
    }
    const start = validDateOrNull(request.query.start || today());
    const end = validDateOrNull(request.query.end || start);
    if (!start || !end) {
      throw httpError("Gecerli hafta baslangic ve bitis tarihi secilmelidir.", 400);
    }
    const params = [start, end];
    const filters = ["a.lesson_date BETWEEN $1 AND $2"];
    const status = nullableText(request.query.status);
    const coachId = Number(request.query.coachId || 0);
    if (status && status !== "all") {
      params.push(status);
      filters.push(`a.status = $${params.length}`);
    }
    if (!isCoach(request.user) && Number.isInteger(coachId) && coachId > 0) {
      params.push(coachId);
      filters.push(`a.recorded_by = $${params.length}`);
    }
    addReportAttendanceAccessFilter(filters, params, request, "a");
    const slotExpression = lessonTimeSql("a");
    const { rows } = await query(
      `SELECT
         a.id,
         a.student_id,
         a.lesson_date,
         a.status,
         a.note,
         a.club_id,
         ${slotExpression} AS start_time,
         s.full_name AS student_name,
         c.name AS club_name,
         u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN clubs c ON c.id = a.club_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY a.lesson_date ASC, ${slotExpression} ASC, lower(s.full_name) ASC`,
      params
    );
    const columnMap = new Map();
    const studentMap = new Map();
    const totals = { total: 0, present: 0, absent: 0, excused: 0, other: 0 };
    for (const row of rows) {
      const date = dateOnly(row.lesson_date);
      const time = row.start_time || normalizeLessonTime(row.start_time) || "";
      const key = `${date}_${time}`;
      if (!columnMap.has(key)) columnMap.set(key, { key, date, time });
      if (!studentMap.has(String(row.student_id))) {
        studentMap.set(String(row.student_id), {
          studentId: row.student_id,
          studentName: row.student_name,
          matrix: {}
        });
      }
      const student = studentMap.get(String(row.student_id));
      student.matrix[key] = {
        status: row.status,
        note: row.note,
        recordedByName: row.recorded_by_name,
        clubName: row.club_name
      };
      totals.total += 1;
      if (row.status === "present") totals.present += 1;
      else if (row.status === "absent") totals.absent += 1;
      else if (row.status === "excused") totals.excused += 1;
      else totals.other += 1;
    }
    const coachResult = await query(
      `SELECT DISTINCT a.recorded_by AS coach_id, COALESCE(u.full_name, 'Sistem') AS coach_name
       FROM attendance_records a
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY coach_name ASC`,
      params
    );
    response.json({
      type: "weekly",
      start,
      end,
      preparedAt: new Date().toISOString(),
      columns: Array.from(columnMap.values()),
      students: Array.from(studentMap.values()),
      sessions: [],
      totals,
      coaches: coachResult.rows.map((row) => ({ id: row.coach_id, name: row.coach_name }))
    });
  })
);

app.get(
  "/api/reports/attendance-print",
  requireAuth,
  requirePermission("attendance:read"),
  asyncHandler(async (request, response) => {
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup raporu icin yetkiniz yok.", 403);
    }
    const lessonDate = validDateOrNull(request.query.date || today());
    if (!lessonDate) {
      throw httpError("Gecerli rapor tarihi secilmelidir.", 400);
    }
    const params = [lessonDate];
    const filters = ["a.lesson_date = $1"];
    addReportAttendanceAccessFilter(filters, params, request, "a");
    const slotExpression = lessonTimeSql("a");
    const { rows } = await query(
      `SELECT
         a.*,
         ${slotExpression} AS normalized_start_time,
         s.full_name AS student_name,
         c.name AS club_name,
         u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN clubs c ON c.id = a.club_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY ${slotExpression} ASC, lower(s.full_name) ASC`,
      params
    );
    const sessionsByKey = new Map();
    for (const row of rows) {
      const startTime = row.normalized_start_time || normalizeLessonTime(row.start_time) || row.start_time;
      const key = `${dateOnly(row.lesson_date)}_${startTime}_${row.club_id || "center"}`;
      if (!sessionsByKey.has(key)) {
        sessionsByKey.set(key, {
          id: key,
          lessonDate: row.lesson_date,
          dayOfWeek: row.day_of_week || dayNameForDate(row.lesson_date),
          startTime,
          clubId: row.club_id,
          clubName: row.club_name,
          total: 0,
          present: 0,
          absent: 0,
          excused: 0,
          other: 0,
          recordedByNames: new Set(),
          recordedAt: row.created_at,
          updatedAt: row.updated_at,
          records: []
        });
      }
      const session = sessionsByKey.get(key);
      session.total += 1;
      if (row.status === "present") session.present += 1;
      else if (row.status === "absent") session.absent += 1;
      else if (row.status === "excused") session.excused += 1;
      else session.other += 1;
      if (row.recorded_by_name) session.recordedByNames.add(row.recorded_by_name);
      if (!session.recordedAt || new Date(row.created_at) > new Date(session.recordedAt)) session.recordedAt = row.created_at;
      if (!session.updatedAt || new Date(row.updated_at) > new Date(session.updatedAt)) session.updatedAt = row.updated_at;
      session.records.push({
        id: row.id,
        studentId: row.student_id,
        studentName: row.student_name,
        status: row.status,
        note: row.note,
        recordedByName: row.recorded_by_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    const sessions = Array.from(sessionsByKey.values()).map((session) => ({
      ...session,
      recordedByName: Array.from(session.recordedByNames).join(", ") || "Sistem",
      recordedByNames: undefined
    }));
    const totals = sessions.reduce((sum, session) => ({
      total: sum.total + session.total,
      present: sum.present + session.present,
      absent: sum.absent + session.absent,
      excused: sum.excused + session.excused,
      other: sum.other + session.other
    }), { total: 0, present: 0, absent: 0, excused: 0, other: 0 });
    response.json({
      date: lessonDate,
      dayOfWeek: dayNameForDate(lessonDate),
      preparedAt: new Date().toISOString(),
      clubName: sessions[0]?.clubName || null,
      sessions,
      totals: {
        ...totals,
        attendanceRate: totals.total ? Math.round((totals.present / totals.total) * 100) : 0
      }
    });
  })
);

app.patch(
  "/api/reports/attendance-session/:id/reset",
  requireAuth,
  requirePermission("attendance:write"),
  asyncHandler(async (request, response) => {
    if (!canResetAttendanceSession(request.user)) {
      throw httpError("Yoklama temizleme yetkiniz yok.", 403);
    }
    if (!validAttendanceResetConfirm(request.body?.confirm)) {
      throw httpError("Yoklama temizleme icin TEMIZLE onayi gereklidir.", 400);
    }
    const session = parseAttendanceSessionId(request.params.id);
    if (!session) {
      throw httpError("Gecerli yoklama oturumu secilmelidir.", 400);
    }
    if (hasForbiddenClubOverride(request)) {
      throw httpError("Bu kulup yoklamasi icin yetkiniz yok.", 403);
    }
    const scopedClubId = isSuperAdmin(request.user) ? session.clubId : getUserClubId(request.user);
    if (!scopedClubId || String(scopedClubId) !== String(session.clubId)) {
      throw httpError("Bu kulup yoklamasi icin yetkiniz yok.", 403);
    }

    const resetResult = await transaction(async (client) => {
      const params = [session.lessonDate, session.startTime, session.clubId];
      const before = await client.query(
        `SELECT a.*, s.full_name AS student_name
         FROM attendance_records a
         JOIN students s ON s.id = a.student_id
         WHERE a.lesson_date = $1
           AND ${lessonTimeSql("a")} = $2
           AND a.club_id = $3
         ORDER BY lower(s.full_name) ASC`,
        params
      );
      const deleted = await client.query(
        `DELETE FROM attendance_records
         WHERE lesson_date = $1
           AND ${lessonTimeSql("attendance_records")} = $2
           AND club_id = $3
         RETURNING id`,
        params
      );
      await audit(
        client,
        request,
        "reset",
        "attendance_session",
        `${session.lessonDate}_${session.startTime}_${session.clubId}`,
        {
          club_id: session.clubId,
          lessonDate: session.lessonDate,
          startTime: session.startTime,
          recordCount: before.rows.length,
          recordIds: before.rows.map((row) => row.id)
        },
        {
          club_id: session.clubId,
          reset: true,
          deletedRecordCount: deleted.rowCount
        }
      );
      return {
        resetCount: deleted.rowCount,
        clubId: session.clubId,
        lessonDate: session.lessonDate,
        startTime: session.startTime
      };
    });

    response.json({ ok: true, ...resetResult });
  })
);

app.patch(
  "/api/reports/attendance-records/:id",
  requireAuth,
  requirePermission("attendance:write"),
  asyncHandler(async (request, response) => {
    const status = validAttendanceEditStatus(request.body.status);
    if (!status) {
      response.status(400).json({ error: "Gecerli yoklama durumu secilmelidir." });
      return;
    }
    const params = [request.params.id];
    const filters = ["a.id = $1"];
    addReportAttendanceAccessFilter(filters, params, request, "a");
    const before = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}`,
      params
    );
    if (!before.rows[0]) {
      response.status(404).json({ error: "Yoklama kaydi bulunamadi." });
      return;
    }
    if (isCoach(request.user) && dateOnly(before.rows[0].lesson_date) !== today()) {
      response.status(403).json({ error: "Coach gecmis gun yoklamasini duzenleyemez." });
      return;
    }
    const updated = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE attendance_records
         SET status = $1, updated_at = now()
         WHERE id = $2
         RETURNING *`,
        [status, request.params.id]
      );
      await audit(client, request, "update", "attendance", request.params.id, before.rows[0], result.rows[0]);
      return result.rows[0];
    });
    response.json({ attendance: mapAttendance({ ...updated, student_name: before.rows[0].student_name, recorded_by_name: before.rows[0].recorded_by_name }) });
  })
);

app.patch(
  "/api/reports/attendance-session/:id/cancel",
  requireAuth,
  requirePermission("attendance:write"),
  (_request, response) => {
    response.status(501).json({
      error: "Yoklama iptali icin cancelled_at, cancelled_by ve cancellation_reason kolonlarini ekleyen migration gereklidir."
    });
  }
);

app.get(
  "/api/attendance/report",
  requireAuth,
  requirePermission("attendance:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const dateFrom = request.query.dateFrom || request.query.from || today();
    const dateTo = request.query.dateTo || request.query.to || dateFrom;
    const params = [dateFrom, dateTo];
    const filters = ["a.lesson_date BETWEEN $1 AND $2"];
    const startTime = normalizeLessonTime(request.query.time);
    const status = nullableText(request.query.status);
    const coachId = Number(request.query.coachId || 0);
    const studentId = Number(request.query.studentId || 0);
    if (startTime) {
      params.push(startTime);
      filters.push(`${lessonTimeSql("a")} = $${params.length}`);
    }
    if (status && status !== "all") {
      params.push(status);
      filters.push(`a.status = $${params.length}`);
    }
    if (!isCoach(request.user) && Number.isInteger(coachId) && coachId > 0) {
      params.push(coachId);
      filters.push(`a.recorded_by = $${params.length}`);
    }
    if (Number.isInteger(studentId) && studentId > 0) {
      params.push(studentId);
      filters.push(`a.student_id = $${params.length}`);
    }
    addAttendanceAccessFilter(filters, params, request.user, "a");
    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY a.lesson_date DESC, ${lessonTimeSql("a")} ASC, lower(s.full_name) ASC
       LIMIT 1000`,
      params
    );
    const attendance = rows.map(mapAttendance);
    const present = attendance.filter((item) => item.status === "present").length;
    const absent = attendance.filter((item) => item.status === "absent").length;
    response.json({
      attendance,
      summary: {
        total: attendance.length,
        present,
        absent,
        attendanceRate: present + absent ? Math.round((present / (present + absent)) * 100) : 0
      }
    });
  })
);

app.get(
  "/api/attendance",
  requireAuth,
  requirePermission("attendance:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const lessonDate = request.query.date || today();
    const params = [lessonDate];
    const filters = ["a.lesson_date = $1"];
    addAttendanceAccessFilter(filters, params, request.user, "a");
    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       ${whereClause(filters)}
       ORDER BY ${lessonTimeSql("a")} ASC, lower(s.full_name) ASC`,
      params
    );
    response.json({ attendance: rows.map(mapAttendance) });
  })
);

app.post(
  "/api/attendance",
  requireAuth,
  requirePermission("attendance:write"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const studentId = Number(request.body.studentId);
    const lessonDate = request.body.lessonDate || today();
    const startTime = normalizeLessonTime(request.body.startTime) || "00:00";
    const dayOfWeek = nullableText(request.body.dayOfWeek);
    const status = ["present", "absent", "excused", "planned"].includes(request.body.status)
      ? request.body.status
      : "present";

    const attendance = await transaction(async (client) => {
      const student = await fetchAccessibleStudentMeta(client, request.user, studentId);
      if (!student) {
        const error = new Error("Ogrenci bulunamadi veya bu ders icin yetkiniz yok.");
        error.status = 404;
        throw error;
      }
      const { rows } = await client.query(
        `INSERT INTO attendance_records
          (student_id, club_id, branch_id, lesson_date, day_of_week, start_time, status, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (student_id, lesson_date, start_time)
         DO UPDATE SET
          day_of_week = EXCLUDED.day_of_week,
          club_id = EXCLUDED.club_id,
          branch_id = EXCLUDED.branch_id,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          recorded_by = EXCLUDED.recorded_by
         RETURNING *`,
        [
          studentId,
          student.club_id,
          student.branch_id,
          lessonDate,
          dayOfWeek,
          startTime,
          status,
          nullableText(request.body.note),
          request.user.id
        ]
      );
      await audit(client, request, "upsert", "attendance", rows[0].id, null, rows[0]);
      return rows[0];
    });

    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.id = $1 AND a.club_id = $2`,
      [attendance.id, attendance.club_id]
    );
    response.status(201).json({ attendance: mapAttendance(rows[0]) });
  })
);

app.get(
  "/api/users",
  requireAuth,
  requirePermission("users:read"),
  asyncHandler(async (request, response) => {
    const params = [];
    const filters = [];
    if (isSuperAdmin(request.user)) {
      const requestedClub = String(request.query.clubId || "all").trim();
      if (requestedClub === "center") {
        filters.push("users.club_id IS NULL");
      } else {
        const clubId = Number(requestedClub);
        if (Number.isInteger(clubId) && clubId > 0) {
          params.push(clubId);
          filters.push(`users.club_id = $${params.length}`);
        }
      }
    } else {
      addTenantFilter(filters, params, request.user, "users");
      addClubManagedUserFilter(filters, params, request.user, "users");
    }
    const roleFilter = String(request.query.role || "all").trim();
    if (roleFilter !== "all") {
      params.push(roleFilter);
      filters.push(`users.role = $${params.length}`);
    }
    const search = nullableText(request.query.search);
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(users.full_name ILIKE $${params.length} OR users.username ILIKE $${params.length} OR clubs.name ILIKE $${params.length})`);
    }
    const { rows } = await query(
      `SELECT users.id, users.username, users.full_name, users.role, users.club_id, clubs.name AS club_name, users.active, users.created_at, users.updated_at
       FROM users
       LEFT JOIN clubs ON clubs.id = users.club_id
       ${whereClause(filters)}
       ORDER BY clubs.name NULLS FIRST, lower(users.full_name)`,
      params
    );
    response.json({ users: rows.map(publicUser) });
  })
);

app.post(
  "/api/users",
  requireAuth,
  requirePermission("users:write"),
  asyncHandler(async (request, response) => {
    const username = nullableText(request.body.username);
    const fullName = nullableText(request.body.fullName);
    const role = normalizeCreatableRole(request.body.role, request.user);
    if (!role) {
      response.status(403).json({ error: "Bu rol icin yetkiniz yok." });
      return;
    }
    if (!isSuperAdmin(request.user) && !CLUB_MANAGED_ROLES.has(role)) {
      response.status(403).json({ error: "Bu rol kulup yoneticisi tarafindan yonetilemez." });
      return;
    }
    const password = String(request.body.password || "");
    if (request.body.passwordConfirm !== undefined && password !== String(request.body.passwordConfirm || "")) {
      response.status(400).json({ error: "Sifre ve sifre tekrar eslesmiyor." });
      return;
    }
    if (!username || !fullName || password.length < 8) {
      response.status(400).json({ error: "Kullanici adi, ad soyad ve en az 8 karakter sifre gerekir." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await transaction(async (client) => {
      const exists = await client.query("SELECT id FROM users WHERE lower(username) = lower($1)", [username]);
      if (exists.rows[0]) {
        const error = new Error("Bu kullanici adi/e-posta zaten kullaniliyor.");
        error.status = 409;
        throw error;
      }
      let clubId = null;
      if (isSuperAdmin(request.user)) {
        if (role !== "super_admin") {
          clubId = Number(request.body.clubId);
          if (!Number.isInteger(clubId) || clubId < 1) {
            const error = new Error("Kulup yoneticisi/antrenor/yardimci kullanici icin bagli kulup secilmelidir.");
            error.status = 400;
            throw error;
          }
          const club = await client.query("SELECT id FROM clubs WHERE id = $1", [clubId]);
          if (!club.rows[0]) {
            const error = new Error("Secilen kulup bulunamadi.");
            error.status = 404;
            throw error;
          }
        }
      } else {
        clubId = getUserClubId(request.user) || await defaultClubId(client);
      }
      if (!isSuperAdmin(request.user) && !clubId) {
        const error = new Error("Kulup baglantisi bulunamadi.");
        error.status = 400;
        throw error;
      }
      const active = request.body.active === undefined ? true : boolValue(request.body.active);
      const result = await client.query(
        `INSERT INTO users (username, full_name, role, password_hash, club_id, active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
        [username, fullName, role, passwordHash, clubId, active]
      );
      await audit(client, request, "create", "user", result.rows[0].id, null, publicUser(result.rows[0]));
      return result;
    });
    response.status(201).json({ user: publicUser(rows[0]) });
  })
);

app.patch(
  "/api/users/:id",
  requireAuth,
  requirePermission("users:write"),
  asyncHandler(async (request, response) => {
    const username = nullableText(request.body.username);
    const fullName = nullableText(request.body.fullName);
    const role = normalizeCreatableRole(request.body.role, request.user);
    if (!role) {
      response.status(403).json({ error: "Bu rol icin yetkiniz yok." });
      return;
    }
    const requestedActive = request.body.active;
    const password = String(request.body.password || "");
    if (request.body.passwordConfirm !== undefined && password !== String(request.body.passwordConfirm || "")) {
      response.status(400).json({ error: "Sifre ve sifre tekrar eslesmiyor." });
      return;
    }
    if (!username || !fullName) {
      response.status(400).json({ error: "Kullanici adi/e-posta ve ad soyad zorunludur." });
      return;
    }
    if (password && password.length < 8) {
      response.status(400).json({ error: "Yeni sifre en az 8 karakter olmalidir." });
      return;
    }
    const beforeParams = [request.params.id];
    const beforeFilters = ["id = $1"];
    addTenantFilter(beforeFilters, beforeParams, request.user, "users");
    const beforeResult = await query(
      `SELECT id, username, full_name, role, club_id, active
       FROM users
       ${whereClause(beforeFilters)}`,
      beforeParams
    );
    if (!beforeResult.rows[0]) {
      response.status(404).json({ error: "Kullanici bulunamadi." });
      return;
    }
    const active = requestedActive === undefined ? beforeResult.rows[0].active !== false : boolValue(requestedActive);
    if (!canManageClubUser(request.user, beforeResult.rows[0])) {
      response.status(403).json({ error: "Bu kullanici uzerinde islem yapamazsiniz." });
      return;
    }
    if (!isSuperAdmin(request.user) && !CLUB_MANAGED_ROLES.has(role)) {
      response.status(403).json({ error: "Bu rol kulup yoneticisi tarafindan yonetilemez." });
      return;
    }

    const updated = await transaction(async (client) => {
      const exists = await client.query(
        "SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2",
        [username, request.params.id]
      );
      if (exists.rows[0]) {
        const error = new Error("Bu kullanici adi/e-posta zaten kullaniliyor.");
        error.status = 409;
        throw error;
      }
      let clubId = beforeResult.rows[0].club_id || null;
      if (isSuperAdmin(request.user)) {
        if (role === "super_admin") {
          clubId = null;
        } else {
          clubId = Number(request.body.clubId);
          if (!Number.isInteger(clubId) || clubId < 1) {
            const error = new Error("Bu rol icin bagli kulup secilmelidir.");
            error.status = 400;
            throw error;
          }
          const club = await client.query("SELECT id FROM clubs WHERE id = $1", [clubId]);
          if (!club.rows[0]) {
            const error = new Error("Secilen kulup bulunamadi.");
            error.status = 404;
            throw error;
          }
        }
      }
      let result;
      if (password) {
        result = await client.query(
          `UPDATE users SET username = $1, full_name = $2, role = $3, club_id = $4, active = $5, password_hash = $6, updated_at = now()
           WHERE id = $7 AND ($8::bigint IS NULL OR club_id = $8)
           RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
          [username, fullName, role, clubId, active, await hashPassword(password), request.params.id, beforeResult.rows[0].club_id]
        );
      } else {
        result = await client.query(
          `UPDATE users SET username = $1, full_name = $2, role = $3, club_id = $4, active = $5, updated_at = now()
           WHERE id = $6 AND ($7::bigint IS NULL OR club_id = $7)
           RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
          [username, fullName, role, clubId, active, request.params.id, beforeResult.rows[0].club_id]
        );
      }
      await audit(client, request, "update", "user", request.params.id, beforeResult.rows[0], publicUser(result.rows[0]));
      return result.rows[0];
    });
    if (!updated) return;
    response.json({ user: publicUser(updated) });
  })
);

app.get(
  "/api/audit-logs",
  requireAuth,
  requirePermission("audit:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const params = [];
    const filters = [];
    addTenantFilter(filters, params, request.user, "a");
    const { rows } = await query(
      `SELECT a.*, u.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereClause(filters)}
       ORDER BY a.created_at DESC
       LIMIT 200`,
      params
    );
    response.json({ logs: rows });
  })
);

app.get(
  "/api/backups",
  requireAuth,
  requirePermission("backup:read"),
  requireSelectedClubForSuperAdmin,
  asyncHandler(async (request, response) => {
    const params = [];
    const filters = [];
    addTenantFilter(filters, params, request.user, "backups");
    const { rows } = await query(
      `SELECT *
       FROM backups
       ${whereClause(filters)}
       ORDER BY created_at DESC
       LIMIT 100`,
      params
    );
    response.json({ backups: rows });
  })
);

app.post(
  "/api/backups/run",
  requireAuth,
  requirePermission("backup:run"),
  asyncHandler(async (request, response) => {
    if (!isSuperAdmin(request.user)) {
      response.status(403).json({ error: "Yedek alma islemi yalnizca super_admin icin aciktir." });
      return;
    }
    const client = await pool.connect();
    try {
      const backup = await runBackup(client, request.user.id);
      response.status(201).json({ backup });
    } finally {
      client.release();
    }
  })
);

app.use(express.static(PUBLIC_DIR));
app.get("*", (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Sunucu hatasi olustu." : error.message
  });
});

function cryptoRandomId() {
  return require("crypto").randomUUID();
}

async function start() {
  await bootstrapAdmin();
  scheduleBackups(pool, process.env.AUTO_BACKUP_HOURS || 24);
  app.listen(PORT, () => {
    console.log(`KulupAsist uygulamasi ${PORT} portunda calisiyor.`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = app;
