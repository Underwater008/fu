-- 005_fix_anon_draws.sql — Give anonymous users 15 welcome draws (was defaulting to 10)

-- Update column default
ALTER TABLE profiles ALTER COLUMN draws_remaining SET DEFAULT 15;

-- Update trigger to explicitly set 15 draws for all new users
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, referral_code, is_anonymous, draws_remaining)
  VALUES (
    new.id,
    new.email,
    COALESCE(split_part(new.email, '@', 1), 'Guest'),
    substr(gen_random_uuid()::text, 1, 8),
    COALESCE(new.is_anonymous, false),
    15
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
