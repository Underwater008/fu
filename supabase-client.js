// supabase-client.js — Shared singleton Supabase client
import { CONFIG } from './config.js';

let supabasePromise = null;

export async function getSupabaseClient() {
  if (!CONFIG.isProd) return null;
  if (supabasePromise) return supabasePromise;

  supabasePromise = import('https://esm.sh/@supabase/supabase-js@2')
    .then(({ createClient }) => createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey));

  return supabasePromise;
}
