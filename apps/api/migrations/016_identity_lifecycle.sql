ALTER TABLE staff_users
  ADD COLUMN phone_number text,
  ADD COLUMN profile_picture_path text,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN signup_completed_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE staff_users ADD CONSTRAINT staff_users_email_unique UNIQUE(email);

CREATE TABLE user_credentials (
  user_id uuid PRIMARY KEY REFERENCES staff_users(id) ON DELETE CASCADE,
  password_hash text,
  verification_token_hash text,
  verification_expires_at timestamptz,
  password_reset_token_hash text,
  password_reset_expires_at timestamptz,
  totp_secret_ciphertext bytea,
  totp_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((totp_enabled AND totp_secret_ciphertext IS NOT NULL) OR NOT totp_enabled)
);

CREATE FUNCTION touch_identity_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER staff_users_updated_at BEFORE UPDATE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION touch_identity_updated_at();
CREATE TRIGGER user_credentials_updated_at BEFORE UPDATE ON user_credentials
  FOR EACH ROW EXECUTE FUNCTION touch_identity_updated_at();

INSERT INTO user_credentials(user_id)
SELECT id FROM staff_users ON CONFLICT DO NOTHING;

ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY credential_owner_only ON user_credentials
  USING (user_id=nullif(current_setting('app.actor',true),'')::uuid)
  WITH CHECK (user_id=nullif(current_setting('app.actor',true),'')::uuid);
