-- 008_fix_reward_rpc_ambiguity.sql — Qualify columns to avoid PL/pgSQL name ambiguity

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
  v_cooldown constant int := 900;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  UPDATE profiles AS p
  SET last_share_time = now(),
      draws_remaining = COALESCE(p.draws_remaining, 0) + v_draws
  WHERE p.id = v_uid
    AND (
      p.last_share_time IS NULL
      OR p.last_share_time <= now() - make_interval(secs => v_cooldown)
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

  UPDATE profiles AS p
  SET ad_draws_date = v_today,
      ad_draws_today = CASE
        WHEN p.ad_draws_date = v_today THEN COALESCE(p.ad_draws_today, 0) + 1
        ELSE 1
      END,
      draws_remaining = COALESCE(p.draws_remaining, 0) + v_draws
  WHERE p.id = v_uid
    AND (
      p.ad_draws_date IS DISTINCT FROM v_today
      OR COALESCE(p.ad_draws_today, 0) < v_daily_limit
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

  UPDATE profiles AS p
  SET login_streak = v_streak,
      last_login_date = v_today,
      draws_remaining = COALESCE(p.draws_remaining, 0) + v_draws
  WHERE p.id = v_uid
  RETURNING * INTO v_profile;

  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_uid, 'daily_login', v_draws);

  RETURN QUERY
  SELECT v_streak, v_draws, (v_streak = 7), v_profile.draws_remaining, v_today;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_share_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ad_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_login_reward() TO authenticated;
