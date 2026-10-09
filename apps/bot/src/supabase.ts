import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { accountIds, amountInCents, type TransactionDraft } from "@finance-tracker/domain";
import { decimalCents, centsDecimal, ReconciliationError, type ReconciliationRepository, type CashPreview, type CashRequest, type CashReceipt } from "./reconciliation.js";
import { PersistenceError, mapTransaction, type TransactionRepository } from "./persistence.js";

export const boundedSupabaseFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(15_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export interface SupabaseConfig { url: string; anonKey: string; email: string; password: string }
export function readSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_USER_EMAIL: email, SUPABASE_USER_PASSWORD: password } = env;
  if (!url || !anonKey || !email || !password) throw new PersistenceError("configuration");
  try {
    if (!["https:", "http:"].includes(new URL(url).protocol)) throw new Error();
    if (anonKey.startsWith("sb_secret_")) throw new Error();
    const jwt = anonKey.split(".");
    if (jwt.length === 3 && JSON.parse(Buffer.from(jwt[1], "base64url").toString()).role !== "anon") throw new Error();
  } catch { throw new PersistenceError("configuration"); }
  return { url, anonKey, email, password };
}

function queryError(stage: "accounts_query" | "insert", code?: string): PersistenceError {
  return new PersistenceError(code === "PT409" ? "conflict" : code === "PT404" ? "account_missing" : code === "22023" ? "mapping" : code === "PGRST202" ? "configuration" : code === "PT423" ? "closed" : code === "42501" ? "rls" : code?.startsWith("23") ? "constraint" : stage);
}

export class SupabaseTransactionRepository implements TransactionRepository, ReconciliationRepository {
  private client?: SupabaseClient;
  private config?: SupabaseConfig;
  constructor(private readonly configuration = readSupabaseConfig, private readonly clientFactory = createClient) {}

  private async authenticate(): Promise<{ client: SupabaseClient; userId: string }> {
    this.config ??= this.configuration();
    this.client ??= this.clientFactory(this.config.url, this.config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedSupabaseFetch },
    });
    const client = this.client;
    let session;
    try {
      const result = await client.auth.getSession();
      if (result.error) throw new PersistenceError("session");
      session = result.data.session;
      if (!session || !session.expires_at || session.expires_at * 1000 <= Date.now() + 30_000) {
        const login = await client.auth.signInWithPassword({ email: this.config.email, password: this.config.password });
        if (login.error) throw new PersistenceError("authentication");
        session = login.data.session;
      }
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("authentication"); }
    if (!session?.user?.id || !session.access_token) throw new PersistenceError("session");
    let userId: string;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.id !== session.user.id) throw new PersistenceError("session");
      userId = data.user.id;
    } catch { throw new PersistenceError("session"); }
    return { client, userId };
  }

  async getTransactionReceipt(requestId: string): Promise<{ id: string } | null> {
    const { client } = await this.authenticate();
    try {
      const { data, error } = await client.rpc("get_transaction_receipt", { p_request_id: requestId });
      if (error) throw queryError("insert", error.code);
      if (!Array.isArray(data) || data.length > 1) throw new PersistenceError("insert");
      if (data.length === 0) return null;
      if (typeof data[0]?.transaction_id !== "string") throw new PersistenceError("insert");
      return { id: data[0].transaction_id };
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("insert"); }
  }

  async saveTransaction(transaction: TransactionDraft, requestId: string): Promise<{ id: string }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new PersistenceError("mapping");
    const { client, userId } = await this.authenticate();
    // Reuse domain validation with conceptual IDs. UUID resolution now occurs inside the atomic RPC.
    const payload = mapTransaction(transaction, userId, accountIds.map(name => ({ id: name, name, user_id: userId, is_active: true })));
    const cents = BigInt(amountInCents(payload.amount)!);
    try {
      const { data, error } = await client.rpc("save_transaction_once", { p_request_id: requestId,
        p_type: payload.type, p_amount: centsDecimal(cents), p_date: payload.transaction_date,
        p_category: payload.category, p_from_account: payload.from_account_id, p_to_account: payload.to_account_id });
      if (error) throw queryError("insert", error.code);
      if (!Array.isArray(data) || data.length !== 1 || typeof data[0]?.transaction_id !== "string") throw new PersistenceError("insert");
      return { id: data[0].transaction_id };
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("insert"); }
  }

  private async cashRpc(name: string, args: Record<string, string>): Promise<Record<string, unknown>> {
    let client: SupabaseClient;
    try { ({ client } = await this.authenticate()); }
    catch { throw new ReconciliationError('access'); }
    try {
      const { data, error } = await client.rpc(name, args);
      if (error) {
        const codes: Record<string, ConstructorParameters<typeof ReconciliationError>[0]> = {
          PT412: 'unconfigured', PT423: 'closed', PT409: 'changed', PT404: 'account',
          '42501': 'access', '22023': 'invalid', '22003': 'invalid', PGRST202: 'access',
          '23505': 'changed',
        };
        throw new ReconciliationError(codes[error.code] ?? 'unknown');
      }
      if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') throw new ReconciliationError('unknown');
      return data[0];
    } catch (error) { throw error instanceof ReconciliationError ? error : new ReconciliationError('unknown'); }
  }

  async previewCash(date: string): Promise<CashPreview> {
    const row = await this.cashRpc('preview_cash_reconciliation', { p_date: date });
    if (typeof row.account_id !== 'string' || typeof row.theoretical_balance !== 'string') throw new ReconciliationError('unknown');
    try {
      const theoretical = centsDecimal(decimalCents(row.theoretical_balance));
      return { accountId: row.account_id, theoretical };
    } catch { throw new ReconciliationError('unknown'); }
  }

  async reconcileCash(request: CashRequest): Promise<CashReceipt> {
    if (decimalCents(request.observed) < 0n) throw new ReconciliationError('invalid');
    decimalCents(request.expected);
    const row = await this.cashRpc('reconcile_cash', { p_account_id: request.accountId, p_date: request.date,
      p_observed: request.observed, p_expected: request.expected, p_request_id: request.requestId });
    if (typeof row.adjustment_id !== 'string' || typeof row.delta !== 'string' || typeof row.observed_balance !== 'string') throw new ReconciliationError('unknown');
    try {
      if (decimalCents(row.observed_balance) !== decimalCents(request.observed) || decimalCents(row.delta) !== decimalCents(request.observed) - decimalCents(request.expected)) throw new ReconciliationError('unknown');
      return { id: row.adjustment_id, delta: centsDecimal(decimalCents(row.delta)), observed: centsDecimal(decimalCents(row.observed_balance)) };
    } catch { throw new ReconciliationError('unknown'); }
  }

}
export const supabaseRepository: TransactionRepository & ReconciliationRepository = new SupabaseTransactionRepository();
