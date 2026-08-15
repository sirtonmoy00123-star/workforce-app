// Supabase client for use in Client Components (browser).
// Uses the public anon key only — safe to expose to the browser.
// Row Level Security (RLS) policies in the database enforce what this client can read/write.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
