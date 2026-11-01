import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readPublicConfig } from "./config";

let client: SupabaseClient | undefined;
export function getBrowserSupabase(): SupabaseClient | null {
  const config = readPublicConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!config) return null;
  client ??= createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "financetracker-web-auth",
    },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      }),
    },
  });
  return client;
}
