import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Null when Supabase env vars are absent. Everything that touches the DB
 * degrades to a no-op in that case, so `DEMO_MODE=true` runs with zero setup.
 * ponytail: silent degrade, not a startup check — swap for a hard fail if the
 * cache ever becomes load-bearing rather than a credit saver.
 */
export const db: SupabaseClient | null =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      )
    : null;
