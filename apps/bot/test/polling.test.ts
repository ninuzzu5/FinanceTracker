vi.mock("../src/supabase.js", () => ({ supabaseRepository: { saveTransaction: vi.fn().mockResolvedValue({ id: "synthetic-row" }) } }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPolling } from "../src/polling.js";

const config = { token: "synthetic", allowedChatId: "123456", timeZone: "Europe/Rome", defaultAccount: "revolut" as const };
const update = (id: number, chatId = 123456) => ({
  update_id: id, message: { message_id: id, text: "8,30 tabacco", chat: { id: chatId, type: "private" } },
});
afterEach(() => vi.useRealTimers());

describe("polling", () => {
  it("routes callback queries from getUpdates and acknowledges them", async () => {
    const controller = new AbortController();
    let polls = 0;
    const client = {
      call: vi.fn(async (method: string) => {
        if (method === "getWebhookInfo") return { url: "" };
        if (method !== "getUpdates") return true;
        if (++polls === 1) return [update(1)];
        const keyboard = client.sendMessage.mock.calls[0][3] as { inline_keyboard: { callback_data: string }[][] };
        return [{ update_id: 2, callback_query: {
          id: "synthetic-callback", from: { id: 123456 }, data: keyboard.inline_keyboard[0][0].callback_data,
          message: { message_id: 99, chat: { id: 123456, type: "private" } },
        } }];
      }),
      sendMessage: vi.fn(async (..._args: unknown[]) => {}),
    };
    await runPolling(client, config, controller.signal, { sleep: async () => { if (polls === 2) controller.abort(); } });
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.sendMessage.mock.calls[1][1]).toContain("Transazione registrata");
    expect(client.call).toHaveBeenCalledWith("answerCallbackQuery", expect.objectContaining({ callback_query_id: "synthetic-callback" }), controller.signal);
  });
  it("processes edits with the same message_id and a new update_id, then advances offset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    const controller = new AbortController();
    const original = update(20);
    original.message.text = "mercoledì barbiere 34€";
    const edited = { update_id: 21, edited_message: { ...original.message, text: "mercoledì barbiere 34€ isybank" } };
    const client = {
      call: vi.fn().mockResolvedValueOnce({ url: "" }).mockResolvedValueOnce([original])
        .mockResolvedValueOnce([edited, edited]).mockResolvedValueOnce([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    let cycles = 0;
    await runPolling(client, config, controller.signal, { sleep: async () => { if (++cycles === 3) controller.abort(); } });
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.sendMessage.mock.calls[0][1]).toContain("Revolut");
    expect(client.sendMessage.mock.calls[1][1]).toContain("Isybank");
    expect(client.sendMessage.mock.calls[1][1]).toContain("16/09/2026");
    expect(client.sendMessage.mock.calls[1][1]).toContain("Anteprima aggiornata");
    expect(client.call.mock.calls.slice(1).map(([, body]) => body.offset)).toEqual([0, 21, 22]);
  });
  it("advances offsets for processed and ignored updates and skips duplicates in this session", async () => {
    const controller = new AbortController();
    const client = {
      call: vi.fn().mockResolvedValueOnce({ url: "" })
        .mockResolvedValueOnce([null, update(10), update(10), update(11, 999), { update_id: 12, edited_message: {} }])
        .mockResolvedValueOnce([update(10), { update_id: 13, message: { text: 123 } }, update(14)]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    let cycles = 0;
    await runPolling(client, config, controller.signal, { sleep: async () => { if (++cycles === 2) controller.abort(); } });
    expect(client.call.mock.calls).toEqual([
      ["getWebhookInfo", {}, controller.signal],
      ["getUpdates", { offset: 0, timeout: 30, allowed_updates: ["message", "edited_message", "callback_query"] }, controller.signal],
      ["getUpdates", { offset: 13, timeout: 30, allowed_updates: ["message", "edited_message", "callback_query"] }, controller.signal],
    ]);
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("checks webhook conflict without deleting it or exposing its URL", async () => {
    const client = { call: vi.fn().mockResolvedValue({ url: "https://private.example/secret" }), sendMessage: vi.fn() };
    await expect(runPolling(client, config, new AbortController().signal)).rejects.toThrow("Webhook Telegram già configurato");
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it.each([null, {}, { url: 123 }])("fails closed for invalid webhook information %#", async (result) => {
    const client = { call: vi.fn().mockResolvedValue(result), sendMessage: vi.fn() };
    await expect(runPolling(client, config, new AbortController().signal)).rejects.toThrow("verificare");
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge an update whose reply failed", async () => {
    const client = { call: vi.fn().mockResolvedValueOnce({ url: "" }).mockResolvedValueOnce([update(7)]), sendMessage: vi.fn().mockRejectedValue(new Error("safe error")) };
    await expect(runPolling(client, config, new AbortController().signal)).rejects.toThrow("safe error");
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid update batches", async () => {
    const client = { call: vi.fn().mockResolvedValueOnce({ url: "" }).mockResolvedValueOnce({}), sendMessage: vi.fn() };
    await expect(runPolling(client, config, new AbortController().signal)).rejects.toThrow("non valido");
  });

  it("paces empty responses and supports shutdown", async () => {
    const controller = new AbortController();
    const client = { call: vi.fn().mockResolvedValueOnce({ url: "" }).mockResolvedValueOnce([]), sendMessage: vi.fn() };
    const sleep = vi.fn(async () => { controller.abort(); });
    await runPolling(client, config, controller.signal, { sleep });
    expect(sleep).toHaveBeenCalledWith(250, controller.signal);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
