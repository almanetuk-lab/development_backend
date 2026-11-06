-- Re-point payments.user_id from profiles to users.
-- Apply manually (psql or Supabase SQL editor) BEFORE an admin erases any account.
--
-- Why: payments.user_id currently references profiles with ON DELETE NO ACTION,
-- so deleting the profile of any user who has paid fails. Account erasure
-- deletes the profile but keeps payments on the users tombstone row (tax law).
--
-- Check first: every payments.user_id must exist in users, or step 2 fails.
--   SELECT p.id, p.user_id FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL;
-- If payments.user_id actually stores profiles.id (not profiles.user_id), STOP:
-- the values must be mapped to users.id first.
--   SELECT ccu.column_name FROM information_schema.constraint_column_usage ccu
--   JOIN information_schema.table_constraints tc ON tc.constraint_name = ccu.constraint_name
--   WHERE tc.table_name = 'payments' AND tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'profiles';

BEGIN;

-- 1. Drop whichever FK on payments.user_id points at profiles
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = 'payments' AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'user_id' AND ccu.table_name = 'profiles'
  LOOP
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

-- 2. Users are never hard-deleted any more, so RESTRICT is the safe rule
ALTER TABLE payments
  ADD CONSTRAINT payments_user_id_users_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

COMMIT;
