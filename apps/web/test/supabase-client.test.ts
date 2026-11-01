import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ createClient: vi.fn(() => ({ auth: {} })) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));

beforeEach(() => { vi.resetModules(); });
describe("dedicated browser client", () => {
  it("does not create a client with missing configuration", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    const { getBrowserSupabase } = await import("../src/auth/supabase");
    expect(getBrowserSupabase()).toBeNull();
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it("uses one client with official persistent sessions and automatic refresh", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
    const { getBrowserSupabase } = await import("../src/auth/supabase");
    expect(getBrowserSupabase()).toBe(getBrowserSupabase());
    expect(sdk.createClient).toHaveBeenCalledTimes(1);
    expect(sdk.createClient).toHaveBeenCalledWith("https://project.example.invalid", "sb_publishable_synthetic", {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "financetracker-web-auth" },
      global: { fetch: expect.any(Function) },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a privileged browser key", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.example.invalid");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_synthetic");
    const { getBrowserSupabase } = await import("../src/auth/supabase");
    expect(getBrowserSupabase()).toBeNull();
    expect(sdk.createClient).not.toHaveBeenCalled();
  });
});
