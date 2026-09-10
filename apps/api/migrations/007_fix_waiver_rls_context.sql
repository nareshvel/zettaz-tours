DROP POLICY waiver_templates_tenant ON waiver_templates;
DROP POLICY waiver_signatures_tenant ON waiver_signatures;
CREATE POLICY waiver_templates_tenant ON waiver_templates USING (tenant_id=current_setting('app.tenant',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant',true)::uuid);
CREATE POLICY waiver_signatures_tenant ON waiver_signatures USING (tenant_id=current_setting('app.tenant',true)::uuid) WITH CHECK (tenant_id=current_setting('app.tenant',true)::uuid);
