ALTER TABLE products
  ADD COLUMN internal_name text,
  ADD COLUMN customer_title text,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN product_kind text NOT NULL DEFAULT 'tour'
    CHECK (product_kind IN ('tour','activity','experience','charter','transport','rental','ticket')),
  ADD COLUMN availability_mode text NOT NULL DEFAULT 'fixed_departure'
    CHECK (availability_mode IN ('fixed_departure','opening_hours','open_dated','on_request','resource_window')),
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','archived')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE products
SET internal_name = name, customer_title = name
WHERE internal_name IS NULL OR customer_title IS NULL;
ALTER TABLE products ALTER COLUMN internal_name SET NOT NULL;
ALTER TABLE products ALTER COLUMN customer_title SET NOT NULL;

CREATE TABLE product_options (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  product_id uuid NOT NULL,
  internal_name text NOT NULL,
  customer_title text NOT NULL,
  duration_minutes integer NOT NULL CHECK(duration_minutes > 0 AND duration_minutes <= 10080),
  confirmation_mode text NOT NULL DEFAULT 'instant' CHECK(confirmation_mode IN ('instant','request')),
  pricing_model text NOT NULL DEFAULT 'per_person' CHECK(pricing_model IN ('per_person','per_group','per_unit')),
  private_booking boolean NOT NULL DEFAULT false,
  min_party_size integer NOT NULL DEFAULT 1 CHECK(min_party_size > 0),
  max_party_size integer CHECK(max_party_size IS NULL OR max_party_size >= min_party_size),
  waiver_required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE INDEX product_options_product ON product_options(tenant_id,product_id,active);

CREATE TABLE passenger_units (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  option_id uuid NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  counts_toward_capacity boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,option_id,code),
  FOREIGN KEY(tenant_id,option_id) REFERENCES product_options(tenant_id,id)
);

CREATE TABLE rate_plans (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  option_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0),
  currency text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,option_id) REFERENCES product_options(tenant_id,id),
  FOREIGN KEY(tenant_id,unit_id) REFERENCES passenger_units(tenant_id,id),
  CHECK(start_date <= end_date)
);
CREATE INDEX rate_plans_lookup ON rate_plans(tenant_id,option_id,start_date,end_date);

CREATE TABLE availability_rules (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  option_id uuid NOT NULL,
  schedule_id uuid,
  mode text NOT NULL CHECK(mode IN ('fixed_departure','opening_hours','open_dated','on_request','resource_window')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','paused','archived')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  weekdays integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  capacity integer CHECK(capacity IS NULL OR capacity > 0),
  timezone text NOT NULL,
  minimum_notice_minutes integer NOT NULL DEFAULT 0 CHECK(minimum_notice_minutes >= 0),
  cutoff_minutes integer NOT NULL DEFAULT 0 CHECK(cutoff_minutes >= 0),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,schedule_id),
  FOREIGN KEY(tenant_id,option_id) REFERENCES product_options(tenant_id,id),
  FOREIGN KEY(tenant_id,schedule_id) REFERENCES schedules(tenant_id,id),
  CHECK(start_date <= end_date)
);
CREATE INDEX availability_rules_option ON availability_rules(tenant_id,option_id,status);

CREATE TABLE availability_rule_times (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  local_time time NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,rule_id,local_time),
  FOREIGN KEY(tenant_id,rule_id) REFERENCES availability_rules(tenant_id,id)
);

CREATE TABLE availability_exceptions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  local_date date NOT NULL,
  kind text NOT NULL DEFAULT 'closed' CHECK(kind IN ('closed','capacity_override')),
  capacity integer CHECK(capacity IS NULL OR capacity > 0),
  note text NOT NULL DEFAULT '',
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,rule_id,local_date,kind),
  FOREIGN KEY(tenant_id,rule_id) REFERENCES availability_rules(tenant_id,id)
);

ALTER TABLE departures
  ADD COLUMN option_id uuid,
  ADD COLUMN availability_rule_id uuid,
  ADD COLUMN status text NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','boarding','departed','completed','cancelled')),
  ADD COLUMN ends_at timestamptz;

INSERT INTO product_options(tenant_id,id,product_id,internal_name,customer_title,duration_minutes)
SELECT tenant_id, gen_random_uuid(), id,
       COALESCE(NULLIF(definition->>'optionName',''),'Standard'),
       COALESCE(NULLIF(definition->>'optionName',''),'Standard'),
       GREATEST(1, COALESCE((definition->>'durationMinutes')::integer,120))
FROM products;

INSERT INTO passenger_units(tenant_id,id,option_id,code,label,counts_toward_capacity,sort_order)
SELECT p.tenant_id,gen_random_uuid(),o.id,c.value->>'slug',c.value->>'label',
       COALESCE((c.value->>'countsTowardCapacity')::boolean,true),c.ordinality::integer
FROM products p
JOIN product_options o ON o.tenant_id=p.tenant_id AND o.product_id=p.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.definition->'categories','[]')) WITH ORDINALITY c(value,ordinality);

INSERT INTO rate_plans(tenant_id,id,option_id,unit_id,start_date,end_date,amount_minor)
SELECT p.tenant_id,gen_random_uuid(),o.id,u.id,(r.value->>'startDate')::date,
       (r.value->>'endDate')::date,(r.value->>'amountMinor')::bigint
FROM products p
JOIN product_options o ON o.tenant_id=p.tenant_id AND o.product_id=p.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.definition->'rates','[]')) r(value)
JOIN passenger_units u ON u.tenant_id=p.tenant_id AND u.option_id=o.id AND u.code=r.value->>'category';

INSERT INTO availability_rules(tenant_id,id,option_id,schedule_id,mode,start_date,end_date,weekdays,capacity,timezone)
SELECT s.tenant_id,gen_random_uuid(),o.id,s.id,'fixed_departure',
       (s.definition->>'startDate')::date,(s.definition->>'endDate')::date,
       ARRAY(SELECT jsonb_array_elements_text(s.definition->'weekdays')::integer),
       (s.definition->>'capacity')::integer,t.timezone
FROM schedules s
JOIN product_options o ON o.tenant_id=s.tenant_id AND o.product_id=s.product_id
JOIN tenants t ON t.id=s.tenant_id;

INSERT INTO availability_rule_times(tenant_id,id,rule_id,local_time)
SELECT a.tenant_id,gen_random_uuid(),a.id,(s.definition->>'localTime')::time
FROM availability_rules a JOIN schedules s ON s.tenant_id=a.tenant_id AND s.id=a.schedule_id;

INSERT INTO availability_exceptions(tenant_id,id,rule_id,local_date)
SELECT a.tenant_id,gen_random_uuid(),a.id,b.value::date
FROM availability_rules a
JOIN schedules s ON s.tenant_id=a.tenant_id AND s.id=a.schedule_id
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.definition->'blackoutDates','[]')) b(value);

UPDATE departures d SET option_id=o.id, availability_rule_id=a.id,
  ends_at=d.starts_at + make_interval(mins => o.duration_minutes)
FROM product_options o
LEFT JOIN availability_rules a ON a.tenant_id=o.tenant_id AND a.option_id=o.id
WHERE o.tenant_id=d.tenant_id AND o.product_id=d.product_id AND (a.schedule_id=d.schedule_id OR a.id IS NULL);

ALTER TABLE departures
  ADD FOREIGN KEY(tenant_id,option_id) REFERENCES product_options(tenant_id,id),
  ADD FOREIGN KEY(tenant_id,availability_rule_id) REFERENCES availability_rules(tenant_id,id);
