-- ============================================================
--  Student Admission Portal — Backup & Restore Module Registration
--  Registers the 'backup' module in the modules table
--  so the Super Admin can lock/unlock it per school via the
--  Module Locks management UI.
--
--  The Backup & Restore page ("Backup & Restore" in the admin sidebar,
--  page-admin-backup) was always present but was NOT lockable —
--  it had no entry in public.modules, so the Super Admin module
--  manager couldn't toggle it. Registering it here (non-core) brings
--  it into the existing lock system: when locked, js/app.js hides the
--  sidebar item and page section for that school, exactly like every
--  other module. No other page references Backup & Restore, so no
--  dependent UI exists to hide elsewhere.
--
--  Run this AFTER 007-settings-permissions.sql (modules table/RLS).
-- ============================================================

INSERT INTO public.modules (name, label, icon, is_core, sort_order) VALUES
  ('backup', 'Backup & Restore', '', false, 14)
ON CONFLICT (name) DO NOTHING;