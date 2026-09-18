import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep, TelegramClient } from "../src/transport.js";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const success = () => response(200, { ok: true, result: [] });
afterEach(() => vi.restoreAllMocks());

describe("Telegram transport (mocked only)", () => {
  it("retries network and server failures with bounded backoff and sanitized diagnostics", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("secret token / chat / financial text"))
      .mockResolvedValueOnce(response(503, { ok: false, description: "private description" }))
      .mockResolvedValueOnce(success());
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    await expect(new TelegramClient("synthetic", { fetch, sleep: wait, onRetry }).call("getUpdates", {})).resolves.toEqual([]);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(onRetry.mock.calls).toEqual([[], []]);
  });

  it("honors retry_after for rate limits", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(429, { ok: false, error_code: 429, parameters: { retry_after: 7 } })).mockResolvedValueOnce(success());
    const wait = vi.fn().mockResolvedValue(undefined);
    await new TelegramClient("synthetic", { fetch, sleep: wait }).call("getUpdates", {});
    expect(wait).toHaveBeenCalledWith(7000, undefined);
  });

  it.each([400, 401, 403, 409])("does not retry permanent API errors %s", async (code) => {
    const fetch = vi.fn().mockResolvedValue(response(code, { ok: false, error_code: code, description: "private" }));
    const wait = vi.fn();
    await expect(new TelegramClient("synthetic", { fetch, sleep: wait }).call("getUpdates", {})).rejects.not.toThrow("private");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("checks Telegram ok even on HTTP 200", async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { ok: false, error_code: 401 }));
    await expect(new TelegramClient("synthetic", { fetch }).call("getUpdates", {})).rejects.toThrow("credenziali");
  });

  it("limits retries and does not expose raw network exceptions", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("https://api.telegram.org/botSECRET/sendMessage financial-text 123456"));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(new TelegramClient("synthetic", { fetch, sleep: wait }).call("getUpdates", {})).rejects.toThrow(/^Problema di rete o timeout Telegram\.$/);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000]);
  });

  it("retries malformed API responses", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, {})).mockResolvedValueOnce(new Response("not JSON"))
      .mockResolvedValueOnce(success());
    await expect(new TelegramClient("synthetic", { fetch, sleep: vi.fn().mockResolvedValue(undefined) }).call("getUpdates", {})).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("times out an unresponsive request", async () => {
    const fetch = vi.fn((_url, init: RequestInit | undefined) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("private timeout details")), { once: true });
    }));
    await expect(new TelegramClient("synthetic", { fetch, timeoutMs: 10, maxAttempts: 1 }).call("getUpdates", {})).rejects.toThrow(/^Problema di rete o timeout Telegram\.$/);
  });

  it("cancels an in-flight request without retrying", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url, init: RequestInit | undefined) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      controller.abort();
    }));
    const wait = vi.fn();
    await expect(new TelegramClient("synthetic", { fetch, sleep: wait }).call("getUpdates", {}, controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("cancels retry waits promptly", async () => {
    const controller = new AbortController();
    const pending = sleep(30_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("serializes replies through the shared transport", async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 1 } }));
    await new TelegramClient("synthetic", { fetch }).sendMessage(123456, "synthetic reply");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ chat_id: 123456, text: "synthetic reply" });
  });
});
