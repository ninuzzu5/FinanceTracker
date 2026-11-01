import { describe, expect, it } from "vitest";
import { readPublicConfig, readWebUserId } from "../src/auth/config";

const config = (key = "sb_publishable_synthetic", url = "https://project.example.invalid") => ({
  VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key,
});
const jwt = (role: string) => `synthetic.${btoa(JSON.stringify({ role }))}.signature`;

describe("public Supabase configuration", () => {
  it("richiede un identificativo UUID per l’account web dedicato", () => {
    expect(readWebUserId("00000000-0000-4000-8000-000000000001")).toBe("00000000-0000-4000-8000-000000000001");
    for (const value of [undefined, "", "person@example.invalid", "not-an-id"]) expect(readWebUserId(value)).toBeNull();
  });
  it("accepts only the two public variables and publishable or legacy anon keys", () => {
    expect(readPublicConfig(config())).toEqual({ url: "https://project.example.invalid", key: "sb_publishable_synthetic" });
    expect(readPublicConfig(config(jwt("anon")))?.key).toBe(jwt("anon"));
    expect(readPublicConfig({ SUPABASE_URL: "https://private.invalid", SUPABASE_ANON_KEY: jwt("anon") })).toBeNull();
  });
  it.each([{}, { VITE_SUPABASE_URL: "https://project.example.invalid" }, config(""), config("sb_publishable_")])("rejects missing configuration %#", env => {
    expect(readPublicConfig(env)).toBeNull();
  });
  it.each(["sb_secret_synthetic", jwt("service_role"), jwt("authenticated"), "malformed", "a.b.c"])("rejects privileged or malformed keys %#", key => {
    expect(readPublicConfig(config(key))).toBeNull();
  });
  it.each(["http://project.example.invalid", "https://user:password@project.example.invalid", "https://@project.example.invalid", "https://project.example.invalid/path", "https://project.example.invalid?secret=value", "https://project.example.invalid#token", " https://project.example.invalid", "invalid"])("rejects invalid URLs %#", url => {
    expect(readPublicConfig(config(undefined, url))).toBeNull();
  });
});
