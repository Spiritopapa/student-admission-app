-- ============================================================
--  Student Admission Portal — Income & Expense Module Registration
--  Registers the 'income-expenses' module in the modules table
--  so the Super Admin can lock/unlock it per school via the
--  Module Locks management UI.
--  Run this AFTER 007-settings-permissions.sql
-- ============================================================

INSERT INTO public.modules (name, label, icon, is_core, sort_order) VALUES
  ('income-expenses', 'Income & Expenses', '', false, 12)
ON CONFLICT (name) DO NOTHING;