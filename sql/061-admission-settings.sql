-- ============================================================
--  Student Admission Portal — Admission Items (Additional Fees)
--  & Admin Settings Module
--  Tables: admission_items
--  Adds:   fees.fee_breakdown (JSONB itemized term fee breakdown)
--  Registers: 'settings' module in public.modules
-- ============================================================

-- ---------------------------------------------------
-- ADMISSION ITEMS (additional fees charged at admission)
-- Each school defines the additional fee items that appear
-- on the Admit Student form with an amount input field.
-- ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admission_items ENABLE ROW LEVEL SECURITY;

-- Admins / sub-admins / accountants manage admission items
CREATE POLICY "Admins manage admission items"
  ON public.admission_items FOR ALL
  USING (public.can_access_school_data(admission_items.school_id))
  WITH CHECK (public.can_access_school_data(admission_items.school_id));

-- Users view admission items for their own school
CREATE POLICY "Users view admission items"
  ON public.admission_items FOR SELECT
  USING (public.can_access_school_data(admission_items.school_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_admission_items_school_name
  ON public.admission_items (school_id, name);

CREATE INDEX IF NOT EXISTS idx_admission_items_school
  ON public.admission_items (school_id);

-- updated_at trigger for admission_items
DROP TRIGGER IF EXISTS set_admission_items_updated_at ON public.admission_items;
CREATE TRIGGER set_admission_items_updated_at
  BEFORE UPDATE ON public.admission_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------
-- FEES: itemized breakdown for each student/term
-- Stores the class (term) fee plus every additional
-- admission item with its amount so receipts and the
-- generated admission form can show the full breakdown.
-- ---------------------------------------------------
ALTER TABLE public.fees
  ADD COLUMN IF NOT EXISTS fee_breakdown JSONB;

-- Backfill: any existing fee records get a breakdown noting only
-- the class/term fee so previously admitted students remain valid.
UPDATE public.fees
SET fee_breakdown = jsonb_build_object(
  'class_fee', COALESCE(total_amount, 0),
  'items', '[]'::jsonb
)
WHERE fee_breakdown IS NULL;

-- ---------------------------------------------------
-- MODULES: register the Settings module so the Super Admin
-- can lock/unlock it per school like every other module.
-- (Core = always offered to every school.)
-- ---------------------------------------------------
INSERT INTO public.modules (name, label, icon, is_core, sort_order)
VALUES ('settings', 'Settings', '', true, 12)
ON CONFLICT (name) DO NOTHING;