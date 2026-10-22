vi.mock("../src/supabase.js", () => ({ supabaseRepository: { getTransactionReceipt: vi.fn().mockResolvedValue(null), saveTransaction: vi.fn().mockResolvedValue({ id: "synthetic-row" }) } }));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/telegram.js";

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:synthetic_test_token_abcdefghijkl");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_ID", "123456");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "synthetic-secret");
  vi.stubEnv("APP_TIMEZONE", "Europe/Rome");
  vi.stubEnv("DEFAULT_ACCOUNT", "revolut");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: {} }))));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() });
let sourceId = 1000;
const headers = { "x-telegram-bot-api-secret-token": "synthetic-secret" };

describe("webhook regression", () => {
  it("shares proposal state between preview and callback in the same process", async () => {
    await handler({ method: "POST", headers, body: { update_id: 101, message: {
      message_id: 101, text: "8,30 tabacco", chat: { id: 123456, type: "private" },
    } } }, response());
    const initial = JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/sendMessage"))![1]?.body as string);
    const data = initial.reply_markup.inline_keyboard[0][0].callback_data;
    await handler({ method: "POST", headers, body: { update_id: 102, callback_query: {
      id: "synthetic-callback", from: { id: 123456 }, data,
      message: { message_id: 201, chat: { id: 123456, type: "private" } },
    } } }, response());
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.filter(([url]) => !String(url).endsWith("/setMyCommands"))).toHaveLength(4);
    calls.splice(0,1);
    expect(JSON.parse(calls[1][1]?.body as string)).toHaveProperty("callback_query_id", "synthetic-callback");
    expect(JSON.parse(calls[2][1]?.body as string)).toHaveProperty("reply_markup.inline_keyboard", []);
    expect(JSON.parse(calls[3][1]?.body as string).text).toContain("Transazione registrata");
  });
  it("replies to an authorized edit of the active source using the corrected date and account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const res = response();
    await handler({ method: "POST", headers, body: { update_id: 202, message: {
      message_id: 202, text: "12 tabacco revolut", chat: { id: 123456, type: "private" },
    } } }, response());
    vi.mocked(fetch).mockClear();
    await handler({ method: "POST", headers, body: { update_id: 203, edited_message: {
      message_id: 202, text: "mercoledì barbiere 34€ isybank", chat: { id: 123456, type: "private" },
    } } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/sendMessage"))![1];
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
    await handler({ method: "POST", headers, body: { update_id: ++sourceId, message: { message_id: sourceId, text, chat: { id: 123456, type: "private" } } } }, res);
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
