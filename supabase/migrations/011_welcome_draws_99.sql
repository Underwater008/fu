-- 011_welcome_draws_99.sql — Give all new users 99 welcome draws

ALTER TABLE profiles ALTER COLUMN draws_remaining SET DEFAULT 99;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_code text;
  v_is_anonymous boolean;
BEGIN
  v_is_anonymous := COALESCE((to_jsonb(NEW) ->> 'is_anonymous')::boolean, NEW.email IS NULL, false);

  LOOP
    v_referral_code := substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 12);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE referral_code = v_referral_code);
  END LOOP;

  INSERT INTO profiles (id, email, display_name, referral_code, is_anonymous, draws_remaining)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(split_part(NEW.email, '@', 1), 'Guest'),
    v_referral_code,
    v_is_anonymous,
    99
  );

  RETURN NEW;
END;
$$;
