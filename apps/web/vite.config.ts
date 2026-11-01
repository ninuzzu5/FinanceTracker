import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readPublicConfig } from "./src/auth/config.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_SUPABASE_");
  const config = readPublicConfig(env);
  if ((env.VITE_SUPABASE_URL || env.VITE_SUPABASE_PUBLISHABLE_KEY) && !config) {
    throw new Error("Configurazione web Supabase non valida: usa un URL HTTPS e una chiave publishable o anon.");
  }
  return {
    plugins: [react()],
    // Exact allowlist: prefixes alone would also expose similarly named secrets.
    envPrefix: [],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(config?.url ?? ""),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(config?.key ?? ""),
    },
    publicDir: false,
    server: { port: 5173, strictPort: true },
  };
});
