ALTER TABLE departures ADD COLUMN operational_status text NOT NULL DEFAULT 'open' CHECK(operational_status IN ('open','weather_hold','closed'));
ALTER TABLE departures ADD COLUMN operational_reason text NOT NULL DEFAULT '';
ALTER TABLE departures ADD COLUMN operational_version integer NOT NULL DEFAULT 1 CHECK(operational_version>0);
