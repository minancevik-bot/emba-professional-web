BEGIN;

CREATE TABLE IF NOT EXISTS clubs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo_url TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  district TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'standard'
    CHECK (plan IN ('free', 'standard', 'owner', 'pro', 'enterprise')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_slug_unique
  ON clubs (slug);

CREATE TABLE IF NOT EXISTS branches (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubs(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'branch'
    CHECK (type IN ('branch', 'hall', 'pool', 'gym')),
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_club_id
  ON branches (club_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_club_id_name_unique
  ON branches (club_id, name);

INSERT INTO clubs (name, slug, status, plan)
VALUES ('EMBA Spor Kulübü', 'emba', 'active', 'owner')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    updated_at = now();

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
INSERT INTO branches (club_id, name, type, active)
SELECT id, 'Ana Şube / Ana Salon', 'branch', TRUE
FROM emba_club
ON CONFLICT (club_id, name) DO UPDATE
SET active = TRUE,
    updated_at = now();

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS club_id BIGINT;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS club_id BIGINT,
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

ALTER TABLE student_lessons
  ADD COLUMN IF NOT EXISTS club_id BIGINT,
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS club_id BIGINT,
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS club_id BIGINT,
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS club_id BIGINT;

ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS club_id BIGINT;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS club_id BIGINT;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE users
SET club_id = emba_club.id
FROM emba_club
WHERE users.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE students
SET club_id = emba_club.id
FROM emba_club
WHERE students.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE student_lessons
SET club_id = COALESCE(
  (SELECT students.club_id FROM students WHERE students.id = student_lessons.student_id),
  emba_club.id
)
FROM emba_club
WHERE student_lessons.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE attendance_records
SET club_id = COALESCE(
  (SELECT students.club_id FROM students WHERE students.id = attendance_records.student_id),
  emba_club.id
)
FROM emba_club
WHERE attendance_records.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE payments
SET club_id = COALESCE(
  (SELECT students.club_id FROM students WHERE students.id = payments.student_id),
  emba_club.id
)
FROM emba_club
WHERE payments.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE audit_logs
SET club_id = emba_club.id
FROM emba_club
WHERE audit_logs.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE backups
SET club_id = emba_club.id
FROM emba_club
WHERE backups.club_id IS NULL;

WITH emba_club AS (
  SELECT id FROM clubs WHERE slug = 'emba'
)
UPDATE app_settings
SET club_id = emba_club.id
FROM emba_club
WHERE app_settings.club_id IS NULL;

WITH emba_branch AS (
  SELECT branches.id
  FROM branches
  JOIN clubs ON clubs.id = branches.club_id
  WHERE clubs.slug = 'emba'
    AND branches.name = 'Ana Şube / Ana Salon'
)
UPDATE students
SET branch_id = emba_branch.id
FROM emba_branch
WHERE students.branch_id IS NULL;

WITH emba_branch AS (
  SELECT branches.id
  FROM branches
  JOIN clubs ON clubs.id = branches.club_id
  WHERE clubs.slug = 'emba'
    AND branches.name = 'Ana Şube / Ana Salon'
)
UPDATE student_lessons
SET branch_id = COALESCE(
  (SELECT students.branch_id FROM students WHERE students.id = student_lessons.student_id),
  emba_branch.id
)
FROM emba_branch
WHERE student_lessons.branch_id IS NULL;

WITH emba_branch AS (
  SELECT branches.id
  FROM branches
  JOIN clubs ON clubs.id = branches.club_id
  WHERE clubs.slug = 'emba'
    AND branches.name = 'Ana Şube / Ana Salon'
)
UPDATE attendance_records
SET branch_id = COALESCE(
  (SELECT students.branch_id FROM students WHERE students.id = attendance_records.student_id),
  emba_branch.id
)
FROM emba_branch
WHERE attendance_records.branch_id IS NULL;

WITH emba_branch AS (
  SELECT branches.id
  FROM branches
  JOIN clubs ON clubs.id = branches.club_id
  WHERE clubs.slug = 'emba'
    AND branches.name = 'Ana Şube / Ana Salon'
)
UPDATE payments
SET branch_id = COALESCE(
  (SELECT students.branch_id FROM students WHERE students.id = payments.student_id),
  emba_branch.id
)
FROM emba_branch
WHERE payments.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_club_id
  ON users (club_id);

CREATE INDEX IF NOT EXISTS idx_students_club_id
  ON students (club_id);

CREATE INDEX IF NOT EXISTS idx_students_branch_id
  ON students (branch_id);

CREATE INDEX IF NOT EXISTS idx_student_lessons_club_id
  ON student_lessons (club_id);

CREATE INDEX IF NOT EXISTS idx_student_lessons_branch_id
  ON student_lessons (branch_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_club_id
  ON attendance_records (club_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_branch_id
  ON attendance_records (branch_id);

CREATE INDEX IF NOT EXISTS idx_payments_club_id
  ON payments (club_id);

CREATE INDEX IF NOT EXISTS idx_payments_branch_id
  ON payments (branch_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_club_id
  ON audit_logs (club_id);

CREATE INDEX IF NOT EXISTS idx_backups_club_id
  ON backups (club_id);

CREATE INDEX IF NOT EXISTS idx_app_settings_club_id
  ON app_settings (club_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_club_id') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_club_id') THEN
    ALTER TABLE students
      ADD CONSTRAINT fk_students_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_students_branch_id') THEN
    ALTER TABLE students
      ADD CONSTRAINT fk_students_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_lessons_club_id') THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT fk_student_lessons_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_student_lessons_branch_id') THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT fk_student_lessons_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_records_club_id') THEN
    ALTER TABLE attendance_records
      ADD CONSTRAINT fk_attendance_records_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_attendance_records_branch_id') THEN
    ALTER TABLE attendance_records
      ADD CONSTRAINT fk_attendance_records_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_club_id') THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_payments_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_branch_id') THEN
    ALTER TABLE payments
      ADD CONSTRAINT fk_payments_branch_id
      FOREIGN KEY (branch_id) REFERENCES branches(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_logs_club_id') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT fk_audit_logs_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_backups_club_id') THEN
    ALTER TABLE backups
      ADD CONSTRAINT fk_backups_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_app_settings_club_id') THEN
    ALTER TABLE app_settings
      ADD CONSTRAINT fk_app_settings_club_id
      FOREIGN KEY (club_id) REFERENCES clubs(id) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clubs_set_updated_at') THEN
      CREATE TRIGGER clubs_set_updated_at
      BEFORE UPDATE ON clubs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'branches_set_updated_at') THEN
      CREATE TRIGGER branches_set_updated_at
      BEFORE UPDATE ON branches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

COMMIT;
