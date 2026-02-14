-- 003_secure_draw_mutations.sql — Harden draw economy mutations

-- Guard economy-sensitive columns so clients cannot self-credit draws.
CREATE OR REPLACE FUNCTION public.guard_profile_economy_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('fu.allow_profile_economy_write', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.draws_remaining IS DISTINCT FROM OLD.draws_remaining
     OR NEW.total_draws IS DISTINCT FROM OLD.total_draws
     OR NEW.pity_counter IS DISTINCT FROM OLD.pity_counter
     OR NEW.login_streak IS DISTINCT FROM OLD.login_streak
     OR NEW.last_login_date IS DISTINCT FROM OLD.last_login_date
     OR NEW.last_share_time IS DISTINCT FROM OLD.last_share_time
     OR NEW.ad_draws_today IS DISTINCT FROM OLD.ad_draws_today
     OR NEW.ad_draws_date IS DISTINCT FROM OLD.ad_draws_date THEN
    RAISE EXCEPTION 'Direct economy mutation is not allowed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_economy ON public.profiles;
CREATE TRIGGER trg_guard_profile_economy
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_economy_mutation();

-- Data migration: normalize upgraded accounts that still carry anonymous flag.
UPDATE profiles
SET is_anonymous = false
WHERE is_anonymous = true
  AND email IS NOT NULL;

-- Atomic draw spending used before each pull.
CREATE OR REPLACE FUNCTION public.spend_draws(p_amount int)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_profile profiles;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET draws_remaining = draws_remaining - p_amount,
      total_draws = COALESCE(total_draws, 0) + p_amount
  WHERE id = v_uid
    AND draws_remaining >= p_amount
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSUFFICIENT_DRAWS';
  END IF;

  RETURN v_profile;
END;
$$;

-- Share reward with server-enforced cooldown.
CREATE OR REPLACE FUNCTION public.claim_share_reward(
  p_draws int DEFAULT 10,
  p_cooldown_seconds int DEFAULT 900
)
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
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET last_share_time = now(),
      draws_remaining = COALESCE(draws_remaining, 0) + p_draws
  WHERE id = v_uid
    AND (
      last_share_time IS NULL
      OR last_share_time <= now() - make_interval(secs => p_cooldown_seconds)
    )
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'share', p_draws);

  RETURN QUERY
  SELECT p_draws, v_profile.draws_remaining, v_profile.last_share_time;
END;
$$;

-- Ad reward with server-enforced daily cap.
CREATE OR REPLACE FUNCTION public.claim_ad_reward(
  p_draws int DEFAULT 1,
  p_daily_limit int DEFAULT 10
)
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
      draws_remaining = COALESCE(draws_remaining, 0) + p_draws
  WHERE id = v_uid
    AND (
      ad_draws_date IS DISTINCT FROM v_today
      OR COALESCE(ad_draws_today, 0) < p_daily_limit
    )
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'ad_reward', p_draws);

  RETURN QUERY
  SELECT p_draws, v_profile.draws_remaining, COALESCE(v_profile.ad_draws_today, 0), v_profile.ad_draws_date;
END;
$$;

-- Daily login reward with server-enforced once-per-day check.
CREATE OR REPLACE FUNCTION public.claim_daily_login_reward(
  p_rewards int[] DEFAULT ARRAY[1,1,2,1,2,2,3]
)
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

  v_draws := COALESCE(p_rewards[v_streak], 1);

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

-- Pity updates are server-side to bypass the trigger guard safely.
CREATE OR REPLACE FUNCTION public.increment_pity_counter(p_amount int DEFAULT 1)
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
  SET pity_counter = COALESCE(pity_counter, 0) + GREATEST(1, COALESCE(p_amount, 1))
  WHERE id = v_uid
  RETURNING profiles.pity_counter INTO v_pity;

  RETURN QUERY SELECT v_pity;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_pity_counter()
RETURNS TABLE(pity_counter int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET pity_counter = 0
  WHERE id = v_uid;

  RETURN QUERY SELECT 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_pity_counter(p_value int)
RETURNS TABLE(pity_counter int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_next int;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_next := GREATEST(0, COALESCE(p_value, 0));
  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles
  SET pity_counter = v_next
  WHERE id = v_uid;

  RETURN QUERY SELECT v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.spend_draws(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_share_reward(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_ad_reward(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_daily_login_reward(int[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_pity_counter(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_pity_counter() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pity_counter(int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.spend_draws(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_share_reward(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_login_reward(int[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_pity_counter(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_pity_counter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pity_counter(int) TO authenticated;
