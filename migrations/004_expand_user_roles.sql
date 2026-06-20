BEGIN;

DO $$
DECLARE
  role_constraint_name TEXT;
BEGIN
  SELECT conname
  INTO role_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%'
  ORDER BY conname
  LIMIT 1;

  IF role_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', role_constraint_name);
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (
      role IN (
        'super_admin',
        'manager',
        'coordinator',
        'coach',
        'assistant',
        'viewer',
        'admin',
        'koordinator',
        'antrenor',
        'izleyici'
      )
    );
END $$;

COMMIT;
