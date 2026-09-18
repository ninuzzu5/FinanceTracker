import { describe, expect, it, vi } from "vitest";
import { runPolling } from "../src/polling.js";

const config = { token: "synthetic", allowedChatId: "123456", timeZone: "Europe/Rome", defaultAccount: "revolut" as const };
const update = (id: number, chatId = 123456) => ({
  update_id: id, message: { message_id: id, text: "8,30 tabacco", chat: { id: chatId, type: "private" } },
});

describe("polling", () => {
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
      ["getUpdates", { offset: 0, timeout: 30, allowed_updates: ["message"] }, controller.signal],
      ["getUpdates", { offset: 13, timeout: 30, allowed_updates: ["message"] }, controller.signal],
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
