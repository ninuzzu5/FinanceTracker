import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { runPolling } from "../src/polling.js";

// Never read the user's environment file or run real polling in entrypoint tests.
vi.mock("node:process", () => ({ loadEnvFile: vi.fn() }));
vi.mock("../src/polling.js", () => ({ runPolling: vi.fn() }));

const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.mocked(loadEnvFile).mockReset();
  vi.mocked(runPolling).mockReset();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:synthetic_test_token_abcdefghijkl");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "123456");
  vi.stubEnv("APP_TIMEZONE", "Europe/Rome");
  vi.stubEnv("DEFAULT_ACCOUNT", "revolut");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in entrypoint test"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local entrypoint", () => {
  it("reports a missing/unreadable env file safely before networking", async () => {
    vi.mocked(loadEnvFile).mockImplementation(() => { throw new Error("private loader details"); });
    await import("../src/local.js");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Impossibile caricare .env.local"));
    expect(runPolling).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("rejects missing credentials before polling", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    await import("../src/local.js");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("TELEGRAM_BOT_TOKEN mancante"));
    expect(runPolling).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("aborts cleanly on Ctrl+C and removes its signal handlers", async () => {
    const listenersBefore = process.listenerCount("SIGINT");
    vi.mocked(runPolling).mockImplementation(async (_client, _config, signal, options) => {
      options?.onReady?.();
      process.emit("SIGINT");
      expect(signal.aborted).toBe(true);
      signal.throwIfAborted();
    });
    await import("../src/local.js");
    expect(loadEnvFile).toHaveBeenCalledWith(".env.local");
    expect(console.log).toHaveBeenCalledWith("Bot locale arrestato.");
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not log unexpected raw errors", async () => {
    vi.mocked(runPolling).mockRejectedValue(new Error("private token chat and financial text"));
    await import("../src/local.js");
    expect(console.error).toHaveBeenCalledWith("Avvio o esecuzione del bot non riusciti. Controlla la configurazione e riprova.");
    expect(process.exitCode).toBe(1);
  });
});
