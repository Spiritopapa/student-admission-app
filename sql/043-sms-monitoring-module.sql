-- ============================================================
--  Student Admission Portal — SMS Monitoring Module Registration
--  Registers the 'sms-monitoring' module in the modules table
--  so the Super Admin can lock/unlock it per school via the
--  Module Locks management UI.
--
--  The module is READ-ONLY monitoring: it reads from the
--  existing public.sms_logs audit table (created by
--  041-sms-gateway.sql), so no new tables are required.
--  sms_logs RLS already limits staff to their own school's rows.
--
--  Run this AFTER 007-settings-permissions.sql and 041-sms-gateway.sql
-- ============================================================

INSERT INTO public.modules (name, label, icon, is_core, sort_order) VALUES
  ('sms-monitoring', 'SMS Monitoring', '📨', false, 13)
ON CONFLICT (name) DO NOTHING;