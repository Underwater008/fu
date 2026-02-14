-- 010_grant_set_pity_to_authenticated.sql — Allow authenticated users to call set_pity_counter
-- Required for multi-draw pity tracking in production.

GRANT EXECUTE ON FUNCTION public.set_pity_counter(int) TO authenticated;
