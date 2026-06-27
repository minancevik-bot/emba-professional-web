BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS passive_date DATE NULL;

CREATE INDEX IF NOT EXISTS idx_students_passive_date
  ON students (passive_date);

COMMIT;
