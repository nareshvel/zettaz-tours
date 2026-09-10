CREATE TABLE connector_definitions (
  code text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK(category IN ('booking_channel','import','standard')),
  lifecycle_status text NOT NULL CHECK(lifecycle_status IN ('available','approval_required','planned')),
  provisioning_available boolean NOT NULL DEFAULT false,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100
);

INSERT INTO connector_definitions(code,name,category,lifecycle_status,provisioning_available,capabilities,description,sort_order) VALUES
 ('wp_travel_engine','WordPress booking site','booking_channel','available',true,'["signed_webhook","product_mapping","review_queue"]','Inbound foundation for the tenant website. Event mapping remains disabled until its actual plugin payload is verified.',10),
 ('viator','Viator','booking_channel','approval_required',false,'["product_mapping","availability","reserve","booking","amendment","cancellation","redemption","reconciliation"]','Requires a registered Viator operator, authorization as reservation-system provider, contract testing, and certification.',20),
 ('getyourguide','GetYourGuide','booking_channel','approval_required',false,'["product_mapping","availability","booking","reconciliation"]','Requires partner access, approved specifications, credentials, and certification.',30),
 ('csv_assisted','CSV assisted import','import','available',false,'["dry_run","quarantine","reconciliation"]','Canonical dry-run import for controlled tenant cutover and exception review.',40),
 ('octo','OCTO','standard','planned',false,'["product","availability","booking"]','Future standards adapter; outside Track A.',50);

ALTER TABLE connector_accounts DROP CONSTRAINT connector_accounts_connector_code_check;
ALTER TABLE connector_accounts ADD CONSTRAINT connector_accounts_definition_fk
  FOREIGN KEY(connector_code) REFERENCES connector_definitions(code);
