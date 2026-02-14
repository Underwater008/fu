-- 004_security_hardening.sql — Fix critical economy exploits and RLS gaps

-- ============================================================
-- CRITICAL: Hardcode economy values — remove client-controlled params
-- ============================================================

-- 1. claim_share_reward: hardcode draws=10, cooldown=900s
CREATE OR REPLACE FUNCTION public.claim_share_reward()
RETURNS TABLE(
  draws_granted int,
  draws_remaining int,
  last_share_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_profile profiles;
  v_draws constant int := 10;
  v_cooldown constant int := 900; -- 15 minutes
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET last_share_time = now(),
      draws_remaining = COALESCE(draws_remaining, 0) + v_draws
  WHERE id = v_uid
    AND (
      last_share_time IS NULL
      OR last_share_time <= now() - make_interval(secs => v_cooldown)
    )
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'share', v_draws);

  RETURN QUERY
  SELECT v_draws, v_profile.draws_remaining, v_profile.last_share_time;
END;
$$;

-- 2. claim_ad_reward: hardcode draws=1, daily_limit=10
CREATE OR REPLACE FUNCTION public.claim_ad_reward()
RETURNS TABLE(
  draws_granted int,
  draws_remaining int,
  ads_watched_today int,
  ad_draws_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_today date;
  v_profile profiles;
  v_draws constant int := 1;
  v_daily_limit constant int := 10;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;
  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET ad_draws_date = v_today,
      ad_draws_today = CASE
        WHEN ad_draws_date = v_today THEN COALESCE(ad_draws_today, 0) + 1
        ELSE 1
      END,
      draws_remaining = COALESCE(draws_remaining, 0) + v_draws
  WHERE id = v_uid
    AND (
      ad_draws_date IS DISTINCT FROM v_today
      OR COALESCE(ad_draws_today, 0) < v_daily_limit
    )
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'ad_reward', v_draws);

  RETURN QUERY
  SELECT v_draws, v_profile.draws_remaining, COALESCE(v_profile.ad_draws_today, 0), v_profile.ad_draws_date;
END;
$$;

-- 3. claim_daily_login_reward: hardcode rewards array
CREATE OR REPLACE FUNCTION public.claim_daily_login_reward()
RETURNS TABLE(
  streak int,
  draws_granted int,
  is_day7 boolean,
  draws_remaining int,
  login_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_profile profiles;
  v_today date;
  v_yesterday date;
  v_streak int;
  v_draws int;
  v_rewards constant int[] := ARRAY[1,1,2,1,2,2,3];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_today := (now() AT TIME ZONE 'UTC')::date;
  v_yesterday := v_today - 1;

  SELECT * INTO v_profile
  FROM profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF v_profile.last_login_date = v_today THEN
    RETURN;
  END IF;

  IF v_profile.last_login_date = v_yesterday THEN
    v_streak := COALESCE(v_profile.login_streak, 0) + 1;
  ELSE
    v_streak := 1;
  END IF;

  IF v_streak > 7 THEN
    v_streak := 1;
  END IF;

  v_draws := COALESCE(v_rewards[v_streak], 1);

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET login_streak = v_streak,
      last_login_date = v_today,
      draws_remaining = COALESCE(draws_remaining, 0) + v_draws
  WHERE id = v_uid
  RETURNING * INTO v_profile;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'daily_login', v_draws);

  RETURN QUERY
  SELECT v_streak, v_draws, (v_streak = 7), v_profile.draws_remaining, v_today;
END;
$$;

-- 4. increment_pity_counter: hardcode to exactly +1
CREATE OR REPLACE FUNCTION public.increment_pity_counter()
RETURNS TABLE(pity_counter int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_pity int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET pity_counter = COALESCE(pity_counter, 0) + 1
  WHERE id = v_uid
  RETURNING profiles.pity_counter INTO v_pity;

  RETURN QUERY SELECT v_pity;
END;
$$;

-- 5. Remove set_pity_counter from public access
REVOKE ALL ON FUNCTION public.set_pity_counter(int) FROM authenticated;
REVOKE ALL ON FUNCTION public.set_pity_counter(int) FROM PUBLIC;

-- ============================================================
-- HIGH: Fix gift RLS policies
-- ============================================================

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can view gifts by token" ON gifts;
DROP POLICY IF EXISTS "Users can claim gifts" ON gifts;

-- Users can see gifts they sent
CREATE POLICY "Users can view own sent gifts"
  ON gifts FOR SELECT
  USING (auth.uid() = sender_id);

-- Users can see gifts they claimed
CREATE POLICY "Users can view own claimed gifts"
  ON gifts FOR SELECT
  USING (auth.uid() = claimed_by);

-- Gift claiming: only unclaimed, unexpired gifts; must set claimed_by to own uid
CREATE POLICY "Users can claim gifts"
  ON gifts FOR UPDATE
  USING (claimed_by IS NULL AND expires_at > now())
  WITH CHECK (claimed_by = auth.uid());

-- Lookup gift by token for claiming (SECURITY DEFINER so it bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_gift_by_token(p_token text)
RETURNS gifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gift gifts;
BEGIN
  SELECT * INTO v_gift FROM gifts WHERE token = p_token;
  RETURN v_gift;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gift_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_by_token(text) TO authenticated;

-- Guard gift claim columns: only claimed_by and claimed_at may change
CREATE OR REPLACE FUNCTION public.guard_gift_claim()
RETURNS trigger AS $$
BEGIN
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.character IS DISTINCT FROM OLD.character
     OR NEW.rarity IS DISTINCT FROM OLD.rarity
     OR NEW.category_name IS DISTINCT FROM OLD.category_name
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only claimed_by and claimed_at may be updated';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_gift_claim ON gifts;
CREATE TRIGGER trg_guard_gift_claim
  BEFORE UPDATE ON gifts
  FOR EACH ROW EXECUTE FUNCTION guard_gift_claim();

-- ============================================================
-- HIGH: Remove transaction INSERT policy (audit log forgery)
-- ============================================================

DROP POLICY IF EXISTS "Users can insert own transactions" ON transactions;

-- ============================================================
-- MEDIUM: Fix handle_new_user search_path + referral code length
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, referral_code, is_anonymous)
  VALUES (
    new.id,
    new.email,
    COALESCE(split_part(new.email, '@', 1), 'Guest'),
    substr(gen_random_uuid()::text, 1, 8) || substr(gen_random_uuid()::text, 10, 4),
    COALESCE(new.is_anonymous, false)
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- ============================================================
-- LOW: Add CHECK constraints on economy columns
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_draws_remaining') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_draws_remaining CHECK (draws_remaining >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_total_draws') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_total_draws CHECK (total_draws >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pity_counter') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_pity_counter CHECK (pity_counter >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_login_streak') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_login_streak CHECK (login_streak >= 0 AND login_streak <= 7);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_referral_count') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_referral_count CHECK (referral_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ad_draws_today') THEN
    ALTER TABLE profiles ADD CONSTRAINT chk_ad_draws_today CHECK (ad_draws_today >= 0);
  END IF;
END $$;

-- ============================================================
-- Update REVOKE/GRANT for new function signatures
-- ============================================================

-- Revoke old signatures
REVOKE ALL ON FUNCTION public.claim_share_reward(int, int) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_share_reward(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_ad_reward(int, int) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_ad_reward(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_daily_login_reward(int[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_daily_login_reward(int[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_pity_counter(int) FROM authenticated;
REVOKE ALL ON FUNCTION public.increment_pity_counter(int) FROM PUBLIC;

-- Drop old overloaded signatures to avoid ambiguity
DROP FUNCTION IF EXISTS public.claim_share_reward(int, int);
DROP FUNCTION IF EXISTS public.claim_ad_reward(int, int);
DROP FUNCTION IF EXISTS public.claim_daily_login_reward(int[]);
DROP FUNCTION IF EXISTS public.increment_pity_counter(int);

-- Grant new parameterless signatures
GRANT EXECUTE ON FUNCTION public.claim_share_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_login_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_pity_counter() TO authenticated;
