import { afterEach, describe, expect, it, vi } from "vitest";
import { mapTransaction, PersistenceError, type AccountRow } from "../src/persistence.js";
import { SupabaseTransactionRepository, readSupabaseConfig } from "../src/supabase.js";
import { ProposalFlow } from "../src/proposal-flow.js";
import { deliverUpdate } from "../src/flow-delivery.js";
import type { TransactionDraft } from "@finance-tracker/domain";

const sdk = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
const user = "00000000-0000-4000-8000-000000000001";
const accounts: AccountRow[] = [
  { id: "00000000-0000-4000-8000-000000000002", user_id: user, name: "Revolut", is_active: true },
  { id: "00000000-0000-4000-8000-000000000003", user_id: user, name: "Isybank", is_active: true },
  { id: "00000000-0000-4000-8000-000000000004", user_id: user, name: " Contanti ", is_active: true },
];
const expense: TransactionDraft = { type: "expense", amount: 12.5, date: "2026-09-18", account: "revolut", category: "food" };
const credentials = { url: "https://synthetic.example", anonKey: "synthetic-public-key", email: "bot@example.invalid", password: "synthetic-password" };
const session = { user: { id: user }, access_token: "synthetic-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
function setup(options: { loginError?: boolean; sessionInvalid?: boolean; accountsError?: string; insertError?: string; rows?: AccountRow[] } = {}) {
  const accountsQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => void) => resolve({ data: options.rows ?? accounts, error: options.accountsError ? { code: options.accountsError, message: "private details" } : null }) };
  const insertQuery = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: "synthetic-transaction" }, error: options.insertError ? { code: options.insertError, message: "private details" } : null }) };
  const client = { auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: options.sessionInvalid ? null : session }, error: options.loginError ? new Error("private credentials") : null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: user } }, error: null }),
  }, from: vi.fn((table: string) => table === "accounts" ? accountsQuery : insertQuery) };
  sdk.createClient.mockReturnValue(client);
  return { repository: new SupabaseTransactionRepository(() => credentials), client, accountsQuery, insertQuery };
}
afterEach(() => { vi.restoreAllMocks(); sdk.createClient.mockReset(); });

describe("Supabase transaction persistence", () => {
  it.each([
    [expense, accounts[0].id, null, "food"],
    [{ ...expense, account: "contanti" }, accounts[2].id, null, "food"],
    [{ ...expense, type: "income", category: "salary", account: "contanti" }, null, accounts[2].id, "salary"],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "revolut", toAccount: "contanti" }, accounts[0].id, accounts[2].id, null],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "contanti", toAccount: "revolut" }, accounts[2].id, accounts[0].id, null],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "isybank", toAccount: "contanti" }, accounts[1].id, accounts[2].id, null],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "contanti", toAccount: "isybank" }, accounts[2].id, accounts[1].id, null],
    [{ ...expense, type: "income", category: "salary", account: "isybank" }, null, accounts[1].id, "salary"],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "revolut", toAccount: "isybank" }, accounts[0].id, accounts[1].id, null],
    [{ type: "transfer", amount: 12.5, date: expense.date, fromAccount: "isybank", toAccount: "revolut" }, accounts[1].id, accounts[0].id, null],
  ] as const)("maps and inserts %s using authenticated ownership", async (transaction, from, to, category) => {
    const { repository, client, accountsQuery, insertQuery } = setup();
    await expect(repository.saveTransaction(transaction as TransactionDraft)).resolves.toEqual({ id: "synthetic-transaction" });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: credentials.email, password: credentials.password });
    expect(accountsQuery.eq).toHaveBeenCalledWith("user_id", user);
    expect(accountsQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(insertQuery.insert).toHaveBeenCalledWith({ user_id: user, type: transaction.type, amount: 12.5, transaction_date: expense.date, category, from_account_id: from, to_account_id: to });
    expect(sdk.createClient).toHaveBeenCalledWith(credentials.url, credentials.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  });
  it.each([
    [{ loginError: true }, "authentication"], [{ sessionInvalid: true }, "session"],
    [{ accountsError: "XX000" }, "accounts_query"], [{ rows: [] }, "account_missing"],
    [{ insertError: "XX000" }, "insert"], [{ insertError: "23514" }, "constraint"], [{ insertError: "42501" }, "rls"],
  ] as const)("propagates safe error %s", async (options, code) => {
    const { repository, insertQuery } = setup(options);
    await expect(repository.saveTransaction(expense)).rejects.toMatchObject({ code, message: `Transaction persistence failed: ${code}` });
    if (!["insert", "constraint", "rls"].includes(code)) expect(insertQuery.insert).not.toHaveBeenCalled();
  });
  it("reuses valid session and verifies the user before queries", async () => {
    const { repository, client } = setup();
    client.auth.getSession.mockResolvedValue({ data: { session }, error: null } as never);
    await repository.saveTransaction(expense);
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "another-synthetic-user" } }, error: null });
    client.from.mockClear();
    await expect(repository.saveTransaction(expense)).rejects.toMatchObject({ code: "session" });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("rejects missing configuration and privileged keys", () => {
    expect(() => readSupabaseConfig({})).toThrow(PersistenceError);
    const env = { SUPABASE_URL: credentials.url, SUPABASE_ANON_KEY: "sb_secret_synthetic", SUPABASE_USER_EMAIL: credentials.email, SUPABASE_USER_PASSWORD: credentials.password };
    expect(() => readSupabaseConfig(env)).toThrow(PersistenceError);
    env.SUPABASE_ANON_KEY = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.synthetic`;
    expect(() => readSupabaseConfig(env)).toThrow(PersistenceError);
  });
  it("rejects missing, inactive, foreign or ambiguous accounts", () => {
    for (const rows of [[], [{ ...accounts[0], is_active: false }], [{ ...accounts[0], user_id: "foreign-user" }], [accounts[0], accounts[0]]]) {
      expect(() => mapTransaction(expense, user, rows)).toThrow(PersistenceError);
    }
  });
  it.each([{ ...expense, amount: 0 }, { ...expense, date: "2026-02-30" }, { ...expense, category: "salary" }, { ...expense, type: null }, { type: "transfer", amount: 12.5, date: expense.date, fromAccount: "revolut", toAccount: "revolut" }])("rejects invalid mapping %s", transaction => {
    expect(() => mapTransaction(transaction as TransactionDraft, user, accounts)).toThrow(PersistenceError);
  });
});

const config = { allowedChatId: "123456" };
const message = (text: string) => ({ update_id: 1, message: { message_id: 1, text, chat: { id: 123456, type: "private" } } });
const callback = (flow: ProposalFlow, action: string) => {
  const p = flow.store.get(123456)!;
  return { update_id: 2, callback_query: { id: "synthetic-query", from: { id: 123456 }, data: `p:${p.id}:${p.revision}:${action}`, message: { message_id: 2, chat: { id: 123456, type: "private" } } } };
};
describe("confirmation persistence boundary", () => {
  it("does not save preview, edits or cancellation; confirms only once including concurrent clicks", async () => {
    const flow = new ProposalFlow();
    const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
    let finish!: (result: { id: string }) => void;
    const repository = { saveTransaction: vi.fn(() => new Promise<{ id: string }>(resolve => { finish = resolve; })) };
    const deliver = (update: unknown) => deliverUpdate(flow, client, update, config, undefined, repository);
    try {
      await deliver(message("12,50 tabacco"));
      await deliver(callback(flow, "field.amount"));
      await deliver(message("15"));
      await deliver({ update_id: 3, edited_message: message("14 tabacco isybank").message });
      await deliver(callback(flow, "cancel"));
      expect(repository.saveTransaction).not.toHaveBeenCalled();
      await deliver(message("12,50 tabacco"));
      const confirm = callback(flow, "confirm");
      const pending = deliver(confirm);
      await vi.waitFor(() => expect(repository.saveTransaction).toHaveBeenCalledTimes(1));
      expect(client.sendMessage.mock.calls.some(call => call[1].includes("Transazione registrata"))).toBe(false);
      await deliver(confirm);
      await deliver(message("/cancel"));
      finish({ id: "synthetic-transaction" });
      await pending;
      await deliver(confirm);
      expect(repository.saveTransaction).toHaveBeenCalledTimes(1);
      expect(flow.store.get(123456)).toBeUndefined();
      expect(client.sendMessage.mock.calls.at(-1)?.[1]).toContain("Transazione registrata");
    } finally { flow.store.clear(); }
  });
  it("keeps a successful insert closed even if Telegram success delivery fails", async () => {
    const flow = new ProposalFlow();
    const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
    const repository = { saveTransaction: vi.fn().mockResolvedValue({ id: "synthetic-transaction" }) };
    try {
      await deliverUpdate(flow, client, message("12 tabacco"), config, undefined, repository);
      const confirm = callback(flow, "confirm");
      client.sendMessage.mockRejectedValueOnce(new Error("Telegram unavailable"));
      await expect(deliverUpdate(flow, client, confirm, config, undefined, repository)).rejects.toThrow("Telegram unavailable");
      expect(flow.store.get(123456)).toBeUndefined();
      await deliverUpdate(flow, client, confirm, config, undefined, repository);
      expect(repository.saveTransaction).toHaveBeenCalledTimes(1);
    } finally { flow.store.clear(); }
  });
  it.each(["authentication", "account_missing", "insert", "constraint", "rls"] as const)("retains proposal without false success after %s", async code => {
    const flow = new ProposalFlow();
    const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
    const repository = { saveTransaction: vi.fn().mockRejectedValue(new PersistenceError(code)) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await deliverUpdate(flow, client, message("12 tabacco"), config, undefined, repository);
      await deliverUpdate(flow, client, callback(flow, "confirm"), config, undefined, repository);
      expect(flow.store.get(123456)).toBeDefined();
      expect(client.sendMessage.mock.calls.some(call => call[1].includes("Transazione registrata"))).toBe(false);
      expect(log).toHaveBeenCalledWith("Transaction persistence failed", code);
      repository.saveTransaction.mockResolvedValueOnce({ id: "synthetic-transaction" });
      await deliverUpdate(flow, client, callback(flow, "confirm"), config, undefined, repository);
      expect(flow.store.get(123456)).toBeUndefined();
      expect(client.sendMessage.mock.calls.at(-1)?.[1]).toContain("Transazione registrata");
    } finally { flow.store.clear(); }
  });
});


describe("cash UUID persistence", () => {
  it("fails safely for missing, inactive, foreign or duplicate Contanti accounts", async () => {
    for (const rows of [accounts.slice(0, 2), [{ ...accounts[2], is_active: false }], [{ ...accounts[2], user_id: "foreign-user" }], [accounts[2], accounts[2]]]) {
      const { repository, insertQuery } = setup({ rows });
      await expect(repository.saveTransaction({ ...expense, account: "contanti" })).rejects.toMatchObject({ code: "account_missing" });
      expect(insertQuery.insert).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["12,50 pranzo in contanti", "expense", accounts[2].id, null, "food"],
    ["12,50 stipendio cash", "income", null, accounts[2].id, "salary"],
    ["12,50 da revolut a contanti stipendio", "transfer", accounts[0].id, accounts[2].id, null],
    ["12,50 da liquidi a isybank spesa", "transfer", accounts[2].id, accounts[1].id, null],
  ])("saves %s only after confirmation, using the resolved UUID", async (text, type, from, to, category) => {
    const flow = new ProposalFlow();
    const client = { call: vi.fn().mockResolvedValue(true), sendMessage: vi.fn().mockResolvedValue(undefined) };
    const { repository, insertQuery, client: databaseClient } = setup();
    try {
      await deliverUpdate(flow, client, message(text), config, undefined, repository);
      expect(client.sendMessage.mock.calls[0][1]).toContain("Contanti");
      expect(insertQuery.insert).not.toHaveBeenCalled();
      await deliverUpdate(flow, client, callback(flow, "confirm"), config, undefined, repository);
      const payload = insertQuery.insert.mock.calls[0][0];
      expect(payload).toMatchObject({ type, user_id: user, from_account_id: from, to_account_id: to, category });
      expect(payload).not.toHaveProperty("description");
      expect(databaseClient.from.mock.calls.map(([table]) => table)).toEqual(["accounts", "transactions"]);
      expect(flow.store.get(123456)).toBeUndefined();
    } finally { flow.store.clear(); }
  });
});
