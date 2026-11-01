export function readPublicConfig(env: Record<string, unknown>): { url: string; key: string } | null {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || typeof key !== "string" || !key || key.trim() !== key) return null;
  try {
    const endpoint = new URL(url);
    if (url.trim() !== url || /[\s\\]/u.test(url) || url.includes("@") || endpoint.username || endpoint.password
      || endpoint.protocol !== "https:" || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) return null;
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      // A legacy key must explicitly be anon. This check is not token verification.
      const parts = key.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") return null;
    }
    return { url, key };
  } catch {
    return null;
  }
}

