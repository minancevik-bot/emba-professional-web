BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS birth_year INTEGER,
  ADD COLUMN IF NOT EXISTS age_group TEXT,
  ADD COLUMN IF NOT EXISTS alternate_phone TEXT;

ALTER TABLE student_lessons
  ADD COLUMN IF NOT EXISTS end_time TEXT;

UPDATE student_lessons
SET end_time = CASE
  WHEN start_time LIKE '%-%' THEN split_part(start_time, '-', 2)
  WHEN start_time = '09:00' THEN '10:00'
  WHEN start_time = '10:00' THEN '11:00'
  WHEN start_time = '11:00' THEN '12:00'
  WHEN start_time = '12:00' THEN '13:00'
  WHEN start_time = '13:00' THEN '14:00'
  WHEN start_time = '14:00' THEN '15:00'
  WHEN start_time = '15:00' THEN '16:00'
  WHEN start_time = '16:00' THEN '17:00'
  WHEN start_time = '17:30' THEN '18:30'
  WHEN start_time = '18:30' THEN '19:30'
  WHEN start_time = '19:30' THEN '20:30'
  WHEN start_time = '20:30' THEN '21:30'
  ELSE end_time
END
WHERE end_time IS NULL;

UPDATE student_lessons
SET start_time = split_part(start_time, '-', 1)
WHERE start_time LIKE '%-%';

ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_status_check;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present', 'absent', 'excused', 'makeup', 'blank', 'planned'));

DO $$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'koordinator', 'antrenor', 'coach', 'assistant', 'izleyici', 'viewer'));
END $$;

CREATE INDEX IF NOT EXISTS idx_student_lessons_unique_slot
  ON student_lessons (student_id, day_of_week, start_time);

CREATE INDEX IF NOT EXISTS idx_student_lessons_day_time
  ON student_lessons (day_of_week, start_time);

CREATE INDEX IF NOT EXISTS idx_students_level
  ON students (level);

CREATE INDEX IF NOT EXISTS idx_students_package
  ON students (package_code, package_name);

INSERT INTO app_settings (key, value)
VALUES (
  'club',
  '{
    "name": "EMBA Spor Kulübü",
    "statuses": ["Aktif", "Bekleyen", "Pasif"],
    "programs": ["Yüzme", "Spor", "Yüzme + Spor"],
    "levels": ["Başlangıç", "Orta", "İleri"],
    "days": ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"],
    "timesByDay": {
      "Pazartesi": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Salı": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Çarşamba": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Perşembe": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Cuma": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Cumartesi": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"],
      "Pazar": ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:30", "18:30", "19:30", "20:30"]
    },
    "packages": [
      { "code": "GRUP-YUZME", "name": "Grup Yüzme", "monthlyFee": 6000 },
      { "code": "OZEL-DERS", "name": "Özel Ders", "monthlyFee": 20000 },
      { "code": "YUZME-SPOR", "name": "Yüzme + Spor", "monthlyFee": 8500 }
    ]
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

COMMIT;
