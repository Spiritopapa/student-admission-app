-- ============================================================
--  Student Admission Portal — Settings Module Lockable
--  Makes the 'settings' module lockable per school.
-- ============================================================
-- The 'settings' module (admin Settings page → Admission Items) was
-- registered in 061-admission-settings.sql with is_core = true. Core
-- modules cannot be locked — the Super Admin module manager disables the
-- Lock/Unlock button for them (js/modules/super-admin.js
-- renderModuleToggles). The Admission Items configured in Settings feed the
-- "Term Fees (Class Fee + Additional Items)" block on the Admit Student
-- form, so schools must be able to lock the module (hiding that block) when
-- they do not want to charge fees.
--
-- Making the module non-core keeps existing behavior identical while the
-- module is unlocked (non-core active modules behave exactly like core ones
-- for the school admin) and additionally enables the Super Admin lock toggle.
-- ============================================================

UPDATE public.modules
SET is_core = false
WHERE name = 'settings';