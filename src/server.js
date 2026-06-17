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
const { ROLE_LABELS, permissionsFor, can } = require("./permissions");
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
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name || user.fullName,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    active: user.active,
    permissions: permissionsFor(user.role)
  };
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
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
  await client.query(
    `INSERT INTO audit_logs
      (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
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

async function fetchStudent(client, id) {
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
     LEFT JOIN student_lessons l ON l.student_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [id]
  );
  return rows[0] ? mapStudent(rows[0]) : null;
}

async function replaceLessons(client, studentId, lessons) {
  await client.query("DELETE FROM student_lessons WHERE student_id = $1", [studentId]);
  for (const lesson of lessons) {
    const day = nullableText(lesson.day);
    const time = nullableText(lesson.time);
    if (!day || !time) continue;
    await client.query(
      `INSERT INTO student_lessons (student_id, day_of_week, start_time)
       VALUES ($1, $2, $3)`,
      [studentId, day, time]
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
  await query(
    `INSERT INTO users (username, full_name, role, password_hash)
     VALUES ($1, $2, 'admin', $3)`,
    [username, "EMBA Admin", passwordHash]
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
  asyncHandler(async (_request, response) => {
    const { rows } = await query("SELECT value FROM app_settings WHERE key = 'club'");
    response.json(rows[0]?.value || {});
  })
);

app.get(
  "/api/dashboard",
  requireAuth,
  requirePermission("dashboard:read"),
  asyncHandler(async (_request, response) => {
    const period = normalizePeriodMonth(new Date().toISOString().slice(0, 7));
    const [students, currentPayments, currentDebt, monthlyRevenue, attendance] = await Promise.all([
      query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'Aktif')::int AS active,
          COUNT(*) FILTER (WHERE status = 'Bekleyen')::int AS waiting,
          COUNT(*) FILTER (WHERE status = 'Pasif')::int AS passive
        FROM students`
      ),
      query("SELECT COALESCE(SUM(paid_amount), 0)::numeric AS total FROM payments WHERE period_month = $1", [period]),
      query(
        `SELECT COALESCE(SUM(GREATEST(s.monthly_fee - COALESCE(p.paid, 0), 0)), 0)::numeric AS total
         FROM students s
         LEFT JOIN (
           SELECT student_id, SUM(paid_amount) AS paid
           FROM payments
           WHERE period_month = $1
           GROUP BY student_id
         ) p ON p.student_id = s.id
         WHERE s.status = 'Aktif'`,
        [period]
      ),
      query(
        `SELECT to_char(period_month, 'YYYY-MM') AS month, COALESCE(SUM(paid_amount), 0)::numeric AS total
         FROM payments
         GROUP BY period_month
         ORDER BY period_month DESC
         LIMIT 12`
      ),
      query(
        `SELECT status, COUNT(*)::int AS total
         FROM attendance_records
         WHERE lesson_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY status`
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

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
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
       LEFT JOIN student_lessons l ON l.student_id = s.id
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
      const { rows } = await client.query(
        `INSERT INTO students (
          status, full_name, program, level, package_code, package_name, parent_name, phone,
          social_media_permission, monthly_total_sessions, monthly_swimming_sessions,
          monthly_sport_sessions, monthly_fee, registration_date, note, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
        RETURNING id`,
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
          request.user.id
        ]
      );
      await replaceLessons(client, rows[0].id, payload.lessons);
      const created = await fetchStudent(client, rows[0].id);
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
      const before = await fetchStudent(client, request.params.id);
      if (!before) return null;
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
         WHERE id = $17`,
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
          request.params.id
        ]
      );
      await replaceLessons(client, request.params.id, payload.lessons);
      const updated = await fetchStudent(client, request.params.id);
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
      const before = await fetchStudent(client, request.params.id);
      if (!before) return;
      await client.query("DELETE FROM students WHERE id = $1", [request.params.id]);
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
      const student = await fetchStudent(client, request.params.id);
      if (!student) {
        response.status(404).json({ error: "Ogrenci bulunamadi." });
        return;
      }
      const [payments, attendance] = await Promise.all([
        client.query(
          `SELECT p.*, s.full_name AS student_name
           FROM payments p
           JOIN students s ON s.id = p.student_id
           WHERE p.student_id = $1
           ORDER BY p.period_month DESC, p.created_at DESC`,
          [request.params.id]
        ),
        client.query(
          `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
           FROM attendance_records a
           JOIN students s ON s.id = a.student_id
           LEFT JOIN users u ON u.id = a.recorded_by
           WHERE a.student_id = $1
           ORDER BY a.lesson_date DESC, a.start_time DESC`,
          [request.params.id]
        )
      ]);
      response.json({
        student,
        payments: can(request.user, "payments:read") ? payments.rows.map(mapPayment) : [],
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
    const where = period ? "WHERE p.period_month = $1" : "";
    if (period) params.push(period);
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
      const { rows } = await client.query(
        `INSERT INTO payments
          (student_id, period_month, monthly_fee, paid_amount, payment_date, method, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          studentId,
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
       WHERE p.id = $1`,
      [payment.id]
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
      const { rows } = await client.query("SELECT * FROM payments WHERE id = $1", [request.params.id]);
      if (!rows[0]) return;
      await client.query("DELETE FROM payments WHERE id = $1", [request.params.id]);
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
    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.lesson_date = $1
       ORDER BY a.start_time ASC, lower(s.full_name) ASC`,
      [lessonDate]
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
      const { rows } = await client.query(
        `INSERT INTO attendance_records
          (student_id, lesson_date, day_of_week, start_time, status, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (student_id, lesson_date, start_time)
         DO UPDATE SET
          day_of_week = EXCLUDED.day_of_week,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          recorded_by = EXCLUDED.recorded_by
         RETURNING *`,
        [studentId, lessonDate, dayOfWeek, startTime, status, nullableText(request.body.note), request.user.id]
      );
      await audit(client, request, "upsert", "attendance", rows[0].id, null, rows[0]);
      return rows[0];
    });

    const { rows } = await query(
      `SELECT a.*, s.full_name AS student_name, u.full_name AS recorded_by_name
       FROM attendance_records a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users u ON u.id = a.recorded_by
       WHERE a.id = $1`,
      [attendance.id]
    );
    response.status(201).json({ attendance: mapAttendance(rows[0]) });
  })
);

app.get(
  "/api/users",
  requireAuth,
  requirePermission("users:read"),
  asyncHandler(async (_request, response) => {
    const { rows } = await query(
      "SELECT id, username, full_name, role, active, created_at, updated_at FROM users ORDER BY lower(full_name)"
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
    const role = ["admin", "koordinator", "antrenor", "izleyici"].includes(request.body.role)
      ? request.body.role
      : "izleyici";
    const password = String(request.body.password || "");
    if (!username || !fullName || password.length < 8) {
      response.status(400).json({ error: "Kullanici adi, ad soyad ve en az 8 karakter sifre gerekir." });
      return;
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO users (username, full_name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, full_name, role, active, created_at, updated_at`,
        [username, fullName, role, passwordHash]
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
    const role = ["admin", "koordinator", "antrenor", "izleyici"].includes(request.body.role)
      ? request.body.role
      : "izleyici";
    const active = request.body.active !== false;
    const password = String(request.body.password || "");
    if (password && password.length < 8) {
      response.status(400).json({ error: "Yeni sifre en az 8 karakter olmalidir." });
      return;
    }
    const beforeResult = await query("SELECT id, username, full_name, role, active FROM users WHERE id = $1", [request.params.id]);
    if (!beforeResult.rows[0]) {
      response.status(404).json({ error: "Kullanici bulunamadi." });
      return;
    }

    const updated = await transaction(async (client) => {
      let result;
      if (password) {
        result = await client.query(
          `UPDATE users SET full_name = $1, role = $2, active = $3, password_hash = $4
           WHERE id = $5
           RETURNING id, username, full_name, role, active, created_at, updated_at`,
          [fullName, role, active, await hashPassword(password), request.params.id]
        );
      } else {
        result = await client.query(
          `UPDATE users SET full_name = $1, role = $2, active = $3
           WHERE id = $4
           RETURNING id, username, full_name, role, active, created_at, updated_at`,
          [fullName, role, active, request.params.id]
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
  asyncHandler(async (_request, response) => {
    const { rows } = await query(
      `SELECT a.*, u.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    );
    response.json({ logs: rows });
  })
);

app.get(
  "/api/backups",
  requireAuth,
  requirePermission("backup:read"),
  asyncHandler(async (_request, response) => {
    const { rows } = await query("SELECT * FROM backups ORDER BY created_at DESC LIMIT 100");
    response.json({ backups: rows });
  })
);

app.post(
  "/api/backups/run",
  requireAuth,
  requirePermission("backup:run"),
  asyncHandler(async (request, response) => {
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
