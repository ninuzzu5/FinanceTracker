import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TransactionDraft } from "@finance-tracker/domain";
import { PersistenceError, mapTransaction, type AccountRow, type TransactionRepository } from "./persistence.js";

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
  return new PersistenceError(code === "42501" ? "rls" : code?.startsWith("23") ? "constraint" : stage);
}

export class SupabaseTransactionRepository implements TransactionRepository {
  private client?: SupabaseClient;
  private config?: SupabaseConfig;
  constructor(private readonly configuration = readSupabaseConfig, private readonly clientFactory = createClient) {}

  async saveTransaction(transaction: TransactionDraft): Promise<{ id: string }> {
    this.config ??= this.configuration();
    this.client ??= this.clientFactory(this.config.url, this.config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
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
    let accounts: AccountRow[];
    try {
      const { data, error } = await client.from("accounts").select("id,user_id,name,is_active").eq("user_id", userId).eq("is_active", true);
      if (error) throw queryError("accounts_query", error.code);
      if (!Array.isArray(data) || data.some(row => typeof row.id !== "string" || typeof row.user_id !== "string" || typeof row.name !== "string")) throw new PersistenceError("accounts_query");
      accounts = data;
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("accounts_query"); }
    const payload = mapTransaction(transaction, userId, accounts);
    try {
      const { data, error } = await client.from("transactions").insert(payload).select("id").single();
      if (error) throw queryError("insert", error.code);
      if (!data || typeof data.id !== "string") throw new PersistenceError("insert");
      return { id: data.id };
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError("insert"); }
  }
}
export const supabaseRepository: TransactionRepository = new SupabaseTransactionRepository();
