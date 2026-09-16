-- Migration 082: Fix RLS policy setting names on expense tables
-- Migration 081 used current_setting('app.tenant_id') but the app sets app.tenant.
-- Drop and recreate both policies to match every other table in the schema.

DROP POLICY IF EXISTS expense_categories_tenant ON expense_categories;
CREATE POLICY expense_categories_tenant ON expense_categories
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);

DROP POLICY IF EXISTS expenses_tenant ON expenses;
CREATE POLICY expenses_tenant ON expenses
  USING (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant', true), '')::uuid);
