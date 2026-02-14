-- 007_stripe_fulfillment.sql — Server-side Stripe purchase fulfillment
-- Called by the webhook handler (via service role key) after checkout.session.completed

CREATE OR REPLACE FUNCTION public.credit_stripe_purchase(
  p_user_id uuid,
  p_session_id text,
  p_draws int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate inputs
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_draws <= 0 THEN
    RAISE EXCEPTION 'Invalid parameters';
  END IF;

  -- Idempotency: skip if this session was already processed
  IF EXISTS (
    SELECT 1 FROM transactions
    WHERE stripe_session_id = p_session_id
  ) THEN
    RETURN false;
  END IF;

  -- Bypass the economy write guard trigger
  PERFORM set_config('fu.allow_profile_economy_write', '1', true);

  -- Credit draws
  UPDATE profiles
  SET draws_remaining = COALESCE(draws_remaining, 0) + p_draws
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Record transaction
  INSERT INTO transactions (user_id, type, draws_granted, stripe_session_id)
  VALUES (p_user_id, 'stripe', p_draws, p_session_id);

  RETURN true;
END;
$$;

-- Only callable by service role (webhook handler), not by authenticated users
REVOKE ALL ON FUNCTION public.credit_stripe_purchase(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_stripe_purchase(uuid, text, int) FROM authenticated;
