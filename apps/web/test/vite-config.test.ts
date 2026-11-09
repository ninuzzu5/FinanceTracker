import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "vite";
import config from "../vite.config";

vi.mock("vite", async importOriginal => ({
  ...await importOriginal<typeof import("vite")>(),
  loadEnv: vi.fn(),
}));
const resolveConfig = () => {
  if (typeof config !== "function") throw new Error("Expected Vite configuration function");
  return config({ command: "build", mode: "test" });
};
describe("Vite environment allowlist", () => {
  it("exposes exactly the public names, excluding private and similarly prefixed variables", async () => {
    vi.mocked(loadEnv).mockReturnValue({
      VITE_SUPABASE_URL: "https://project.example.invalid",
      VITE_SUPABASE_WEB_USER_ID: "00000000-0000-4000-8000-000000000001",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
      VITE_SUPABASE_URL_PRIVATE: "synthetic-secret",
      VITE_SUPABASE_PUBLISHABLE_KEY_SECRET: "synthetic-secret",
      VITE_SUPABASE_SERVICE_ROLE: "synthetic-secret",
      TELEGRAM_BOT_TOKEN: "synthetic-secret",
    });
    const resolved = await resolveConfig();
    expect(resolved.envPrefix).toEqual([]);
    expect(resolved.define).toEqual({
      "import.meta.env.VITE_SUPABASE_WEB_USER_ID": JSON.stringify("00000000-0000-4000-8000-000000000001"),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://project.example.invalid"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_synthetic"),
    });
  });

  it("fails the build configuration before a privileged key could enter the bundle", () => {
    vi.mocked(loadEnv).mockReturnValue({ VITE_SUPABASE_URL: "https://project.example.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic" });
    expect(resolveConfig).toThrow("Configurazione web Supabase non valida");
  });

  it("allows an unconfigured build with explicit empty public values", async () => {
    vi.mocked(loadEnv).mockReturnValue({});
    expect((await resolveConfig()).define).toEqual({
      "import.meta.env.VITE_SUPABASE_WEB_USER_ID": '""',
      "import.meta.env.VITE_SUPABASE_URL": '""',
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
    });
  });
});
