-- Wipe ALL tenants + related rows + orphan staff.
-- Must run as postgres (superuser), e.g.:
--   sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/wipe-all-tenants.sql
-- Do NOT run as zettaz_owner in TablePlus (no session_replication_role).

BEGIN;
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE doomed AS SELECT id FROM tenants;

DELETE FROM passenger_checkin_tokens WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM passenger_checkins WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM waiver_signatures WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_passengers WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_checkins WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM payment_adjustments WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM payments WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM price_snapshots WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_change_quotes WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_changes WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM partner_claim_decisions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM partner_obligations WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM partner_collection_claims WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_partner_snapshots WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM booking_partner_attributions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM notification_messages WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM pickup_stops WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM departure_pickup_plans WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM departure_itinerary_points WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM departure_assignments WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM trip_run_events WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM trip_runs WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM print_jobs WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM document_artifacts WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM assisted_import_rows WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM assisted_imports WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM external_mappings WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM webhook_inbox WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM connector_accounts WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM event_receipts WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM outbox_events WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM idempotency_keys WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM audit_events WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM bookings WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM holds WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM customers WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM departures WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM availability_exceptions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM availability_rule_times WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM availability_rules WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM rate_plans WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM passenger_units WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM product_options WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM schedules WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM products WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM compliance_documents WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM crew_profiles WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM operational_resources WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM printer_routes WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM print_templates WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM waiver_templates WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM pickup_locations WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM accommodation_properties WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM cruise_calls WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM partner_organizations WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM staff_sessions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM support_sessions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM support_access_grants WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM tenant_invitations WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM role_permissions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM memberships WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM tenant_roles WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM tenant_subscriptions WHERE tenant_id IN (SELECT id FROM doomed);
DELETE FROM tenants WHERE id IN (SELECT id FROM doomed);

DELETE FROM staff_users su
WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.actor_id = su.id);

SET LOCAL session_replication_role = DEFAULT;
COMMIT;
