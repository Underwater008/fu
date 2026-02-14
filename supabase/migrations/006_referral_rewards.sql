-- 006_referral_rewards.sql — Server-side referral reward processing

CREATE OR REPLACE FUNCTION public.apply_referral(p_referral_code text)
RETURNS TABLE(
  referred_by_id uuid,
  referrer_draws_granted int,
  referrer_draws_remaining int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_caller profiles;
  v_referrer profiles;
  v_is_first boolean;
  v_draws int;
  v_first_draws constant int := 30;
  v_subsequent_draws constant int := 10;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Lock caller's profile and check they haven't already been referred
  SELECT * INTO v_caller
  FROM profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF v_caller.referred_by IS NOT NULL THEN
    RETURN; -- already referred, silently no-op
  END IF;

  -- Look up referrer by code
  SELECT * INTO v_referrer
  FROM profiles
  WHERE referral_code = p_referral_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- invalid code, silently no-op
  END IF;

  -- Prevent self-referral
  IF v_referrer.id = v_uid THEN
    RETURN;
  END IF;

  -- Determine reward amount
  v_is_first := (COALESCE(v_referrer.referral_count, 0) = 0);
  v_draws := CASE WHEN v_is_first THEN v_first_draws ELSE v_subsequent_draws END;

  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  -- Mark caller as referred
  UPDATE profiles
  SET referred_by = v_referrer.id
  WHERE id = v_uid;

  -- Credit referrer
  UPDATE profiles
  SET referral_count = COALESCE(referral_count, 0) + 1,
      draws_remaining = COALESCE(draws_remaining, 0) + v_draws
  WHERE id = v_referrer.id
  RETURNING * INTO v_referrer;

  -- Record transaction for referrer
  INSERT INTO transactions (user_id, type, draws_granted)
  VALUES (v_referrer.id, 'referral', v_draws);

  RETURN QUERY SELECT v_referrer.id, v_draws, v_referrer.draws_remaining;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_referral(text) TO authenticated;
