-- ============================================================
--  Student Admission Portal — Income & Expenditure Tracking Module
--  Tables: income_expense_categories, income_expenses
--  Features: Record income/expenses, category management,
--            date-range reporting, analytics
-- ============================================================

-- ============================================================
--  SECTION 1: INCOME & EXPENSE CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.income_expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  description TEXT,
  color       TEXT DEFAULT '#6366f1',
  icon        TEXT DEFAULT '',
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.income_expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage income_expense categories"
  ON public.income_expense_categories FOR ALL
  USING (public.can_access_school_data(income_expense_categories.school_id));

CREATE POLICY "Users view income_expense categories"
  ON public.income_expense_categories FOR SELECT
  USING (public.can_access_school_data(income_expense_categories.school_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_iec_school_name
  ON public.income_expense_categories (school_id, name, type);

-- ============================================================
--  SECTION 2: INCOME & EXPENSE TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.income_expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id       UUID NOT NULL REFERENCES public.income_expense_categories(id) ON DELETE RESTRICT,
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description       TEXT NOT NULL,
  transaction_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_number  TEXT,
  payment_method    TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'cheque', 'other')),
  notes             TEXT,
  receipt_number    TEXT,
  recorded_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  school_id         UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.income_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage income_expenses"
  ON public.income_expenses FOR ALL
  USING (public.can_access_school_data(income_expenses.school_id));

CREATE POLICY "Users view income_expenses"
  ON public.income_expenses FOR SELECT
  USING (public.can_access_school_data(income_expenses.school_id));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ie_school_id ON public.income_expenses(school_id);
CREATE INDEX IF NOT EXISTS idx_ie_type ON public.income_expenses(type);
CREATE INDEX IF NOT EXISTS idx_ie_category_id ON public.income_expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_ie_transaction_date ON public.income_expenses(transaction_date);
CREATE INDEX IF NOT EXISTS idx_ie_recorded_by ON public.income_expenses(recorded_by);

-- ============================================================
--  SECTION 3: TRIGGERS
-- ============================================================

CREATE TRIGGER set_income_expense_categories_updated_at
  BEFORE UPDATE ON public.income_expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_income_expenses_updated_at
  BEFORE UPDATE ON public.income_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
--  SECTION 4: DEFAULT SEED CATEGORIES (per school)
--  Run after schools exist to populate default categories
-- ============================================================

-- Function to seed default income/expense categories for a school
CREATE OR REPLACE FUNCTION public.seed_income_expense_categories(p_school_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Income categories
  INSERT INTO public.income_expense_categories (name, type, description, color, icon, school_id) VALUES
    ('School Fees', 'income', 'Student tuition and fee payments', '#10b981', '', p_school_id),
    ('PTA Dues', 'income', 'Parent-Teacher Association contributions', '#6366f1', '', p_school_id),
    ('Donations', 'income', 'Donations from individuals and organizations', '#f59e0b', '', p_school_id),
    ('Grants', 'income', 'Government and private grants', '#8b5cf6', '', p_school_id),
    ('Other Income', 'income', 'Miscellaneous income sources', '#06b6d4', '', p_school_id)
  ON CONFLICT (school_id, name, type) DO NOTHING;

  -- Expense categories
  INSERT INTO public.income_expense_categories (name, type, description, color, icon, school_id) VALUES
    ('Salaries', 'expense', 'Staff salaries and wages', '#ef4444', '', p_school_id),
    ('Utilities', 'expense', 'Electricity, water, internet, etc.', '#f97316', '', p_school_id),
    ('Supplies', 'expense', 'Teaching and office supplies', '#eab308', '', p_school_id),
    ('Maintenance', 'expense', 'Building and equipment repairs', '#ec4899', '', p_school_id),
    ('Transport', 'expense', 'Transportation and fuel costs', '#14b8a6', '', p_school_id),
    ('Food & Catering', 'expense', 'Meals and catering services', '#f43f5e', '', p_school_id),
    ('Events', 'expense', 'School events and activities', '#a855f7', '', p_school_id),
    ('Other Expense', 'expense', 'Miscellaneous expenses', '#64748b', '', p_school_id)
  ON CONFLICT (school_id, name, type) DO NOTHING;
END;
$$;

-- Auto-seed categories for existing schools
-- Create a trigger to auto-seed when a new school is created
CREATE OR REPLACE FUNCTION public.auto_seed_income_expense_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_income_expense_categories(NEW.id);
  RETURN NEW;
END;
$$;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS trg_auto_seed_iec ON public.schools;
CREATE TRIGGER trg_auto_seed_iec
  AFTER INSERT ON public.schools
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_seed_income_expense_categories();

-- ============================================================
--  SECTION 5: REPORTING FUNCTIONS
-- ============================================================

-- Get income/expense summary for a date range
CREATE OR REPLACE FUNCTION public.get_ie_summary(
  p_school_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
  total_income NUMERIC,
  total_expense NUMERIC,
  net_balance NUMERIC,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN ie.type = 'income' THEN ie.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN ie.type = 'expense' THEN ie.amount ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(CASE WHEN ie.type = 'income' THEN ie.amount ELSE -ie.amount END), 0) AS net_balance,
    COUNT(*)::BIGINT AS transaction_count
  FROM public.income_expenses ie
  WHERE ie.school_id = p_school_id
    AND (p_from_date IS NULL OR ie.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR ie.transaction_date <= p_to_date);
END;
$$;

-- Get category breakdown for a date range
CREATE OR REPLACE FUNCTION public.get_ie_category_breakdown(
  p_school_id UUID,
  p_type TEXT DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
  category_id UUID,
  category_name TEXT,
  category_icon TEXT,
  category_color TEXT,
  total_amount NUMERIC,
  transaction_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    iec.id,
    iec.name,
    iec.icon,
    iec.color,
    COALESCE(SUM(ie.amount), 0) AS total_amount,
    COUNT(ie.id)::BIGINT AS transaction_count
  FROM public.income_expense_categories iec
  LEFT JOIN public.income_expenses ie ON ie.category_id = iec.id
    AND (p_from_date IS NULL OR ie.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR ie.transaction_date <= p_to_date)
  WHERE iec.school_id = p_school_id
    AND (p_type IS NULL OR iec.type = p_type)
  GROUP BY iec.id, iec.name, iec.icon, iec.color
  ORDER BY total_amount DESC;
END;
$$;

-- ============================================================
--  SECTION 6: SEED EXISTING SCHOOLS
-- ============================================================

-- Seed categories for all existing schools that don't have them
DO $$
DECLARE
  school_record RECORD;
BEGIN
  FOR school_record IN SELECT id FROM public.schools LOOP
    PERFORM public.seed_income_expense_categories(school_record.id);
  END LOOP;
END;
$$;