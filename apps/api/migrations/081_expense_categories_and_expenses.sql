-- Migration 081: Expense categories and expenses
-- Purpose: Foundation for operating expense tracking
-- Part of: Finance System Phase 3

-- ── Expense categories ─────────────────────────────────────────────────────

CREATE TABLE expense_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  code        text,                    -- e.g. "FUEL", "MAINT" — for future accounting export
  sort_order  int         NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON expense_categories(tenant_id, is_active, sort_order);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_categories_tenant ON expense_categories
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Expenses ───────────────────────────────────────────────────────────────

CREATE TABLE expenses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id     uuid        NOT NULL REFERENCES expense_categories(id),
  amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
  currency        char(3)     NOT NULL,
  expense_date    date        NOT NULL,
  vendor          text,
  description     text,
  reference       text,                      -- invoice #, receipt #
  receipt_path    text,                      -- document library path (stub)
  recorded_by     uuid        NOT NULL,      -- staff user id
  voided_at       timestamptz,
  void_reason     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON expenses(tenant_id, expense_date DESC);
CREATE INDEX ON expenses(tenant_id, category_id);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_tenant ON expenses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Seed default categories for existing tenants ──────────────────────────

INSERT INTO expense_categories (tenant_id, name, code, sort_order)
SELECT
  t.id AS tenant_id,
  c.name,
  c.code,
  c.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Fuel & Transport',          'FUEL',   1),
  ('Equipment & Machinery',     'EQUIP',  2),
  ('Maintenance & Repairs',     'MAINT',  3),
  ('Office & Administration',   'OFFICE', 4),
  ('Software & Licenses',       'SW',     5),
  ('Marketing & Advertising',   'MKT',    6),
  ('Insurance',                 'INS',    7),
  ('Professional Services',     'PROF',   8),
  ('Salaries & Wages',          'SAL',    9),
  ('Other',                     'OTHER', 10)
) AS c(name, code, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id
);

-- ── Tenant onboarding hook: seed categories for new tenants ───────────────
-- (Application layer should call: INSERT INTO expense_categories for new tenants at creation)
