-- 009_harden_handle_new_user.sql — Make signup profile trigger robust for anonymous auth

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
  -- Compatibility: auth.users may differ by version; read from JSON instead of direct field access.
  v_is_anonymous := COALESCE((to_jsonb(NEW) ->> 'is_anonymous')::boolean, NEW.email IS NULL, false);

  LOOP
    -- Uses pg_catalog functions only; avoids dependency on extension schema search_path.
    v_referral_code := substr(md5(NEW.id::text || clock_timestamp()::text || random()::text), 1, 12);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE referral_code = v_referral_code);
  END LOOP;

  INSERT INTO profiles (id, email, display_name, referral_code, is_anonymous)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(split_part(NEW.email, '@', 1), 'Guest'),
    v_referral_code,
    v_is_anonymous
  );

  RETURN NEW;
END;
$$;
