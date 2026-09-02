-- ============================================================
--  Student Admission Portal — Nalo Solutions SMS Gateway Logging
--  Table: sms_logs
--
--  Logs every fee-payment SMS sent to parents/guardians through the
--  Nalo Solutions gateway (serverless function /api/send-sms).
--  Used for auditing, duplicate suppression and retry support.
--  Status "1701" from the gateway means the message was accepted.
-- ============================================================

-- ---------------------------------------------------
-- 1. SMS LOGS
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id        TEXT,
  receipt_number    TEXT,                       -- payment receipt that triggered the SMS
  recipient         TEXT NOT NULL,              -- normalized phone 233XXXXXXXXX
  message           TEXT,
  sender_id         TEXT,                       -- Nalo sender id used
  status            TEXT,                       -- Nalo status code (1701 = success)
  success           BOOLEAN NOT NULL DEFAULT false,
  provider_response TEXT,                       -- raw upstream response
  error             TEXT,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- School staff (admins / sub-admins / accountants) manage logs for their school.
-- Guarded so this file is SAFE TO RE-RUN (each policy is created only if it
-- does not already exist) — same convention as 053-clear-activity-logs.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sms_logs'
      AND policyname = 'School staff manage sms logs'
  ) THEN
    CREATE POLICY "School staff manage sms logs"
      ON public.sms_logs FOR ALL
      USING (public.can_access_school_data(sms_logs.school_id));
  END IF;
END $$;

-- Staff read access (kept explicit alongside the FOR ALL policy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'sms_logs'
      AND policyname = 'School staff view sms logs'
  ) THEN
    CREATE POLICY "School staff view sms logs"
      ON public.sms_logs FOR SELECT
      USING (public.can_access_school_data(sms_logs.school_id));
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sms_logs_school_created
  ON public.sms_logs (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_logs_receipt
  ON public.sms_logs (receipt_number);

CREATE INDEX IF NOT EXISTS idx_sms_logs_success
  ON public.sms_logs (success);
