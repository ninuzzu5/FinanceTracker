import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/telegram.js";

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:synthetic_test_token_abcdefghijkl");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "123456");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
  vi.stubEnv("APP_TIMEZONE", "Europe/Rome");
  vi.stubEnv("DEFAULT_ACCOUNT", "revolut");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {} }))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
const headers = { "x-telegram-bot-api-secret-token": "synthetic-secret" };

describe("webhook regression", () => {
  it("replies to an authorized edit using the corrected date and account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const res = response();
    await handler({ method: "POST", headers, body: { update_id: 2, edited_message: {
      message_id: 1, text: "mercoledì barbiere 34€ isybank", chat: { id: 123456, type: "private" },
    } } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const request = vi.mocked(fetch).mock.calls[0][1];
    const body = JSON.parse(request?.body as string);
    expect(body.text).toContain("Isybank");
    expect(body.text).toContain("16/09/2026");
    expect(body.text).toContain("Anteprima aggiornata");
  });
  it("rejects non-POST requests", async () => {
    const res = response();
    await handler({ method: "GET", headers: {}, body: null }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an invalid webhook secret", async () => {
    const res = response();
    await handler({ method: "POST", headers: {}, body: null }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["/start", "/help", "8,30 tabacco", "ciao"])("still responds to %s", async (text) => {
    const res = response();
    await handler({ method: "POST", headers, body: { update_id: 1, message: { message_id: 1, text, chat: { id: 123456, type: "private" } } } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("acknowledges malformed payloads without sending", async () => {
    const res = response();
    await handler({ method: "POST", headers, body: null }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
