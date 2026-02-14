-- 002_anonymous_users.sql — Add anonymous user support

-- Add is_anonymous flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_anonymous boolean DEFAULT false;

-- Update trigger to handle anonymous signups (null email)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, referral_code, is_anonymous)
  VALUES (
    new.id,
    new.email,
    COALESCE(split_part(new.email, '@', 1), 'Guest'),
    substr(gen_random_uuid()::text, 1, 8),
    COALESCE(new.is_anonymous, false)
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
