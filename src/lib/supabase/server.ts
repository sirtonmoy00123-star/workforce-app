// Supabase client for use in Server Components, Route Handlers, and Server Actions.
// Uses the public anon key + the caller's session cookie, so RLS still applies
// based on who is logged in. This is NOT the service-role client.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll was called from a Server Component that can't set cookies.
            // This is fine as long as middleware.ts is refreshing sessions.
          }
        },
      },
    }
  );
}
