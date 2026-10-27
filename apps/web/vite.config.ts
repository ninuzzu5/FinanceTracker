import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Non esporre variabili di ambiente al browser.
  envPrefix: [],
  publicDir: false,
  server: { port: 5173, strictPort: true },
});
