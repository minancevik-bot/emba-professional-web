require("./env").loadEnv();

const path = require("path");
const express = require("express");
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
  normalizeRole,
  isSuperAdmin,
  isCoach,
  normalizeCreatableRole
} = require("./permissions");
const { runBackup, scheduleBackups } = require("./backup");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function publicUser(user) {
  if (!user) return null;
  const normalizedRole = user.normalizedRole || normalizeRole(user.role);
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name || user.fullName,
    role: user.role,
    normalizedRole,
    roleLabel: roleLabel(user.role),
    clubId: user.club_id || user.clubId || null,
    active: user.active,
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

function getUserClubId(user) {
  return user?.club_id || user?.clubId || null;
}

function addTenantFilter(filters, params, user, alias) {
  if (isSuperAdmin(user)) return;
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
  if (!isCoach(user)) return;
  params.push(user.id);
  filters.push(
    `EXISTS (
      SELECT 1
      FROM student_lessons scope_lessons
      WHERE scope_lessons.student_id = ${alias}.id
        AND scope_lessons.trainer_user_id = $${params.length}
    )`
  );
}

function addAttendanceAccessFilter(filters, params, user, attendanceAlias = "a") {
  addTenantFilter(filters, params, user, attendanceAlias);
  if (!isCoach(user)) return;
  params.push(user.id);
  filters.push(
    `EXISTS (
      SELECT 1
      FROM student_lessons scope_lessons
      WHERE scope_lessons.student_id = ${attendanceAlias}.student_id
        AND scope_lessons.trainer_user_id = $${params.length}
    )`
  );
}

function whereClause(filters) {
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

async function resolveWriteClubId(client, request) {
  if (isSuperAdmin(request.user) && request.body?.clubId) return Number(request.body.clubId);
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
    `SELECT s.id, s.full_name, s.club_id, s.branch_id, s.monthly_fee
     FROM students s
     ${whereClause(filters)}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
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
    clearSessionCookie(response);
    response.status(401).json({ error: "Oturum suresi doldu." });
    return;
  }

  user.normalizedRole = normalizeRole(user.role);
  if (!isSuperAdmin(user) && !user.club_id) {
    user.club_id = await defaultClubId();
  }
  if (!isSuperAdmin(user) && !user.club_id) {
    clearSessionCookie(response);
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

function normalizePeriodMonth(value) {
  const input = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(input)) return `${input}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input.slice(0, 7)}-01`;
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function studentPayload(body) {
  return {
    status: ["Aktif", "Bekleyen", "Pasif"].includes(body.status) ? body.status : "Aktif",
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
    lessons: Array.isArray(body.lessons) ? body.lessons.slice(0, 4) : []
  };
}

function mapStudent(row) {
  return {
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
    note: row.note,
    lessons: row.lessons || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
    startTime: row.start_time,
    status: row.status,
    note: row.note,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
  const lessonJoin = isCoach(user)
    ? `LEFT JOIN student_lessons l ON l.student_id = s.id AND l.trainer_user_id = $${params.push(user.id)}`
    : "LEFT JOIN student_lessons l ON l.student_id = s.id";
  const { rows } = await client.query(
    `SELECT
       s.*,
       COALESCE(
         json_agg(
           json_build_object('id', l.id, 'day', l.day_of_week, 'time', l.start_time)
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
  return rows[0] ? mapStudent(rows[0]) : null;
}

async function replaceLessons(client, studentId, lessons, studentContext) {
  const clubId = studentContext?.club_id || null;
  const branchId = studentContext?.branch_id || null;
  if (!clubId) return;
  await client.query("DELETE FROM student_lessons WHERE student_id = $1 AND club_id = $2", [studentId, clubId]);
  for (const lesson of lessons) {
    const day = nullableText(lesson.day);
    const time = nullableText(lesson.time);
    if (!day || !time) continue;
    await client.query(
      `INSERT INTO student_lessons (student_id, club_id, branch_id, day_of_week, start_time)
       VALUES ($1, $2, $3, $4, $5)`,
      [studentId, clubId, branchId, day, time]
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
  response.json({ ok: true, app: "emba-professional-web" });
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
    setSessionCookie(response, token);
    response.json({ user: publicUser(user) });
  })
);

app.post(
  "/api/auth/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(request.sessionToken)]);
    clearSessionCookie(response);
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
  "/api/settings",
  requireAuth,
  requirePermission("dashboard:read"),
  asyncHandler(async (request, response) => {
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
    if (!isSuperAdmin(request.user)) {
      const clubId = getUserClubId(request.user);
      paymentPeriodParams.push(clubId);
      paymentPeriodWhere += ` AND club_id = $${paymentPeriodParams.length}`;
      paymentTenantParams.push(clubId);
      paymentTenantWhere = `WHERE club_id = $${paymentTenantParams.length}`;
      debtParams.push(clubId);
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
  asyncHandler(async (request, response) => {
    const search = String(request.query.q || "").trim();
    const status = String(request.query.status || "").trim();
    const filters = [];
    const params = [];

    if (search) {
      params.push(`%${search.toLocaleLowerCase("tr-TR")}%`);
      filters.push(`lower(s.full_name) LIKE $${params.length}`);
    }
    if (status && status !== "all") {
      params.push(status);
      filters.push(`s.status = $${params.length}`);
    }

    addStudentAccessFilter(filters, params, request.user, "s");
    const lessonJoin = isCoach(request.user)
      ? `LEFT JOIN student_lessons l ON l.student_id = s.id AND l.trainer_user_id = $${params.push(request.user.id)}`
      : "LEFT JOIN student_lessons l ON l.student_id = s.id";
    const where = whereClause(filters);
    const { rows } = await query(
      `SELECT
         s.*,
         COALESCE(
           json_agg(
             json_build_object('id', l.id, 'day', l.day_of_week, 'time', l.start_time)
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
    response.json({ students: rows.map(mapStudent) });
  })
);

app.post(
  "/api/students",
  requireAuth,
  requirePermission("students:write"),
  asyncHandler(async (request, response) => {
    const payload = studentPayload(request.body);
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
      const { rows } = await client.query(
        `INSERT INTO students (
          status, full_name, program, level, package_code, package_name, parent_name, phone,
          social_media_permission, monthly_total_sessions, monthly_swimming_sessions,
          monthly_sport_sessions, monthly_fee, registration_date, note, created_by, updated_by,
          club_id, branch_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16, $17, $18)
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
          payload.note,
          request.user.id,
          clubId,
          branchId
        ]
      );
      await replaceLessons(client, rows[0].id, payload.lessons, rows[0]);
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
  asyncHandler(async (request, response) => {
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
          note = $15,
          updated_by = $16
         WHERE id = $17 AND club_id = $18`,
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
      response.json({
        student,
        payments: payments.rows.map(mapPayment),
        attendance: attendance.rows.map(mapAttendance)
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
  asyncHandler(async (request, response) => {
    const period = request.query.month ? normalizePeriodMonth(request.query.month) : null;
    const params = [];
    const filters = [];
    if (period) {
      params.push(period);
      filters.push(`p.period_month = $${params.length}`);
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
  asyncHandler(async (request, response) => {
    const studentId = Number(request.body.studentId);
    const periodMonth = normalizePeriodMonth(request.body.periodMonth);
    const monthlyFee = numberValue(request.body.monthlyFee);
    const paidAmount = numberValue(request.body.paidAmount);

    const payment = await transaction(async (client) => {
      const student = await fetchAccessibleStudentMeta(client, request.user, studentId);
      if (!student) {
        const error = new Error("Ogrenci bulunamadi.");
        error.status = 404;
        throw error;
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
          request.body.paymentDate || today(),
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

app.delete(
  "/api/payments/:id",
  requireAuth,
  requirePermission("payments:delete"),
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
  "/api/attendance",
  requireAuth,
  requirePermission("attendance:read"),
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
       ORDER BY a.start_time ASC, lower(s.full_name) ASC`,
      params
    );
    response.json({ attendance: rows.map(mapAttendance) });
  })
);

app.post(
  "/api/attendance",
  requireAuth,
  requirePermission("attendance:write"),
  asyncHandler(async (request, response) => {
    const studentId = Number(request.body.studentId);
    const lessonDate = request.body.lessonDate || today();
    const startTime = nullableText(request.body.startTime) || "00:00";
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
    addTenantFilter(filters, params, request.user, "users");
    const { rows } = await query(
      `SELECT id, username, full_name, role, club_id, active, created_at, updated_at
       FROM users
       ${whereClause(filters)}
       ORDER BY lower(full_name)`,
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
    const password = String(request.body.password || "");
    if (!username || !fullName || password.length < 8) {
      response.status(400).json({ error: "Kullanici adi, ad soyad ve en az 8 karakter sifre gerekir." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await transaction(async (client) => {
      const clubId = await resolveWriteClubId(client, request);
      if (!isSuperAdmin(request.user) && !clubId) {
        const error = new Error("Kulup baglantisi bulunamadi.");
        error.status = 400;
        throw error;
      }
      const result = await client.query(
        `INSERT INTO users (username, full_name, role, password_hash, club_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
        [username, fullName, role, passwordHash, clubId]
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
    const fullName = nullableText(request.body.fullName);
    const role = normalizeCreatableRole(request.body.role, request.user);
    if (!role) {
      response.status(403).json({ error: "Bu rol icin yetkiniz yok." });
      return;
    }
    const active = request.body.active !== false;
    const password = String(request.body.password || "");
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

    const updated = await transaction(async (client) => {
      let result;
      if (password) {
        result = await client.query(
          `UPDATE users SET full_name = $1, role = $2, active = $3, password_hash = $4
           WHERE id = $5 AND ($6::bigint IS NULL OR club_id = $6)
           RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
          [fullName, role, active, await hashPassword(password), request.params.id, beforeResult.rows[0].club_id]
        );
      } else {
        result = await client.query(
          `UPDATE users SET full_name = $1, role = $2, active = $3
           WHERE id = $4 AND ($5::bigint IS NULL OR club_id = $5)
           RETURNING id, username, full_name, role, club_id, active, created_at, updated_at`,
          [fullName, role, active, request.params.id, beforeResult.rows[0].club_id]
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
    console.log(`EMBA uygulamasi ${PORT} portunda calisiyor.`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = app;
