BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'koordinator', 'antrenor', 'izleyici')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif', 'Bekleyen', 'Pasif')),
  full_name TEXT NOT NULL,
  program TEXT NOT NULL DEFAULT 'Yüzme',
  level TEXT NOT NULL DEFAULT 'Başlangıç',
  package_code TEXT,
  package_name TEXT,
  parent_name TEXT,
  phone TEXT,
  social_media_permission BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_total_sessions INTEGER NOT NULL DEFAULT 0,
  monthly_swimming_sessions INTEGER NOT NULL DEFAULT 0,
  monthly_sport_sessions INTEGER NOT NULL DEFAULT 0,
  monthly_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_lessons (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,
  start_time TEXT NOT NULL,
  trainer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_date DATE NOT NULL,
  day_of_week TEXT,
  start_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused', 'planned')),
  note TEXT,
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, lesson_date, start_time)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  monthly_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_date DATE,
  method TEXT,
  description TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backups (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  row_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_full_name ON students (lower(full_name));
CREATE INDEX IF NOT EXISTS idx_students_status ON students (status);
CREATE INDEX IF NOT EXISTS idx_student_lessons_student ON student_lessons (student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records (lesson_date);
CREATE INDEX IF NOT EXISTS idx_payments_period ON payments (period_month);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments (student_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS students_set_updated_at ON students;
CREATE TRIGGER students_set_updated_at
BEFORE UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS attendance_set_updated_at ON attendance_records;
CREATE TRIGGER attendance_set_updated_at
BEFORE UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO app_settings (key, value)
VALUES (
  'club',
  '{
    "name": "EMBA Spor Kulübü",
    "statuses": ["Aktif", "Bekleyen", "Pasif"],
    "programs": ["Yüzme", "Spor", "Yüzme + Spor"],
    "levels": ["Başlangıç", "Orta", "İleri"],
    "days": ["Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"],
    "timesByDay": {
      "Salı": ["17:30", "18:30", "19:30", "20:30"],
      "Çarşamba": ["17:30", "18:30", "19:30", "20:30"],
      "Perşembe": ["17:30", "18:30", "19:30", "20:30"],
      "Cuma": ["17:30", "18:30", "19:30", "20:30"],
      "Cumartesi": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"],
      "Pazar": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]
    },
    "packages": [
      { "code": "GRUP-YUZME", "name": "Grup Yüzme", "monthlyFee": 6000 },
      { "code": "OZEL-DERS", "name": "Özel Ders", "monthlyFee": 20000 },
      { "code": "YUZME-SPOR", "name": "Yüzme + Spor", "monthlyFee": 8500 }
    ]
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
