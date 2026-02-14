// api/admin-credit.js — Admin bypass: credit draws with a secret test code
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUNDLES = {
  draws10:  { draws: 10 },
  draws60:  { draws: 60 },
  draws130: { draws: 130 },
};

function isValidCode(code) {
  const configured = process.env.ADMIN_TEST_CODE || '';
  if (!code || !configured) return false;
  const provided = Buffer.from(String(code));
  const expected = Buffer.from(String(configured));
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bundleId, userId, code } = req.body || {};

  if (!process.env.ADMIN_TEST_CODE) {
    return res.status(500).json({ error: 'ADMIN_TEST_CODE not configured' });
  }

  if (!isValidCode(code)) {
    return res.status(403).json({ error: 'Invalid code' });
  }

  if (!bundleId || !userId) {
    return res.status(400).json({ error: 'Missing bundleId or userId' });
  }

  const bundle = BUNDLES[bundleId];
  if (!bundle) {
    return res.status(400).json({ error: 'Invalid bundle' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase service role not configured' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const sessionId = 'admin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const { error } = await supabase.rpc('credit_stripe_purchase', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_draws: bundle.draws,
    });

    if (error) {
      console.error('Failed to credit draws:', error);
      return res.status(500).json({ error: 'Credit failed' });
    }

    return res.status(200).json({ success: true, draws: bundle.draws });
  } catch (err) {
    console.error('Admin credit error:', err);
    return res.status(500).json({ error: err.message });
  }
}
