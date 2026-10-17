import type { AccountBalance, BalancesRepository } from './balances.js';
import { ManagementError, type ManagedDetail, type ManagedMovement, type ChangeRequest, type ChangeReceipt, type ManagementRepository } from './management.js';
import { isRecord } from './telegram.js';
import { expenseCategoryIds, incomeCategoryIds } from '@finance-tracker/domain';
import { historyCents } from "./history.js";
import type { HistoryRepository, HistoryCursor, HistoryPage, HistoryMovement } from "./history.js";
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
  return new PersistenceError(code === "PT422" ? "currency" : code === "PT409" ? "conflict" : code === "PT404" ? "account_missing" : code === "22023" ? "mapping" : code === "PGRST202" ? "configuration" : code === "PT423" ? "closed" : code === "42501" ? "rls" : code?.startsWith("23") ? "constraint" : stage);
}

export class SupabaseTransactionRepository implements TransactionRepository, ReconciliationRepository, HistoryRepository, BalancesRepository, ManagementRepository {
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
    const payload = mapTransaction(transaction, userId, accountIds.map(name => ({ id: name, name, user_id: userId, currency: "EUR", is_active: true })));
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

  async getMovements(cursor: HistoryCursor | null): Promise<HistoryPage> {
    if (cursor && (!/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cursor.id))) throw new PersistenceError('mapping');
    const { client, userId } = await this.authenticate();
    try {
      let query = client.from('transactions').select('id,type,amount::text,transaction_date::text,category,voided_at,from_account:accounts!transactions_from_account_id_fkey(name,currency),to_account:accounts!transactions_to_account_id_fkey(name,currency)')
        .eq('user_id', userId).order('transaction_date', { ascending: false }).order('id', { ascending: false }).limit(6);
      if (cursor) query = query.or(`transaction_date.lt.${cursor.date},and(transaction_date.eq.${cursor.date},id.lt.${cursor.id})`);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw new PersistenceError('accounts_query');
      const rows: HistoryMovement[] = data.map(row => {
        if (!row || typeof row.id !== 'string' || !['expense','income','transfer'].includes(row.type) || typeof row.amount !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.transaction_date) || historyCents(row.amount) <= 0n) throw new PersistenceError('mapping');
        const account = (value: unknown): string | null => {
          if (value === null) return null;
          if (!value || Array.isArray(value) || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || !('currency' in value) || value.currency !== 'EUR') throw new PersistenceError('currency');
          return value.name.replace(/[\r\n\t]/g," ").slice(0,100);
        };
        const from = account(row.from_account), to = account(row.to_account);
        if ((row.type === 'transfer' && (!from || !to)) || (row.type === 'expense' && !from) || (row.type === 'income' && !to)) throw new PersistenceError('mapping');
        return { id: row.id, type: row.type, amount: row.amount, date: row.transaction_date, category: row.category, from, to, voided: row.voided_at != null };
      });
      const visible = rows.slice(0,5), last = visible.at(-1);
      return { rows: visible, next: rows.length > 5 && last ? {date:last.date,id:last.id} : null };
    } catch (error) { throw error instanceof PersistenceError ? error : new PersistenceError('accounts_query'); }
  }

  async getBalances(date: string): Promise<AccountBalance[]> {
    const {client}=await this.authenticate();
    try {
      const {data,error}=await client.rpc('get_account_balances',{p_as_of:date})
        .select('account_id,account_name,currency,is_active,as_of_date::text,status,balance::text');
      if(error || !Array.isArray(data)) throw new PersistenceError('accounts_query');
      const ids=new Set<string>();
      return data.map(row => {
        if(!isRecord(row)||typeof row.account_id!=='string'||ids.has(row.account_id)||typeof row.account_name!=='string'||
          row.currency!=='EUR'||typeof row.is_active!=='boolean'||row.as_of_date!==date||
          !['configured','not_configured','before_opening'].includes(String(row.status))) throw new PersistenceError('mapping');
        ids.add(row.account_id);
        if(row.status==='configured') {if(typeof row.balance!=='string')throw new PersistenceError('mapping');historyCents(row.balance);}
        else if(row.balance!==null)throw new PersistenceError('mapping');
        return {id:row.account_id,name:row.account_name.replace(/[\r\n\t]/g,' ').slice(0,100),active:row.is_active,status:row.status as AccountBalance['status'],balance:row.balance as string|null};
      });
    } catch(error) {throw error instanceof PersistenceError ? error : new PersistenceError('accounts_query');}
  }

  private async managementRpc(name: string,args: Record<string,unknown>): Promise<unknown> {
    try {
      const {client}=await this.authenticate();const {data,error}=await client.rpc(name,args);
      if(error) {
        const codes: Record<string,ConstructorParameters<typeof ManagementError>[0]>={PT409:'changed',PT423:'closed',PT404:'access','42501':'access',PGRST202:'access','22023':'invalid','22003':'invalid','23514':'invalid','23503':'invalid'};
        throw new ManagementError(codes[error.code]??'unknown');
      }
      return data;
    } catch(error) {throw error instanceof ManagementError ? error : new ManagementError(error instanceof PersistenceError ? 'access' : 'unknown');}
  }

  async getMovement(id: string): Promise<ManagedDetail> {
    const data=await this.managementRpc('get_transaction_for_management',{p_transaction_id:id});
    if(!isRecord(data)||!isRecord(data.movement)||!Array.isArray(data.accounts))throw new ManagementError('invalid');
    const row=data.movement;
    const accounts=data.accounts.map(value => {
      if(!isRecord(value)||typeof value.id!=='string'||typeof value.name!=='string'||value.currency!=='EUR'||typeof value.active!=='boolean')throw new ManagementError('invalid');
      return {id:value.id,name:value.name.replace(/[\r\n\t]/g,' ').slice(0,100),currency:'EUR' as const,active:value.active};
    });
    const validDate=typeof row.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && new Date(`${row.date}T00:00:00Z`).toISOString().slice(0,10)===row.date;
    if(row.id!==id||!['expense','income','transfer'].includes(String(row.type))||typeof row.amount!=='string'||historyCents(row.amount)<=0n||!validDate||
      typeof row.version!=='string'||!/^\d+$/.test(row.version)||BigInt(row.version)<1n||BigInt(row.version)>2147483647n||
      !(row.voided_at===null||typeof row.voided_at==='string')||!(row.voided_by===null||typeof row.voided_by==='string')||
      (row.voided_at===null)!==(row.voided_by===null))throw new ManagementError('invalid');
    const has=(value:unknown)=>typeof value==='string'&&accounts.some(a=>a.id===value);
    if(row.type==='transfer' ? !has(row.from_id)||!has(row.to_id)||row.from_id===row.to_id||row.category!==null :
      !((row.type==='expense'?expenseCategoryIds:incomeCategoryIds) as readonly unknown[]).includes(row.category)||
      (row.type==='expense' ? !has(row.from_id)||row.to_id!==null : !has(row.to_id)||row.from_id!==null))throw new ManagementError('invalid');
    return {movement:row as unknown as ManagedMovement,accounts};
  }

  private changeReceipt(data: unknown): ChangeReceipt {
    if(!isRecord(data)||typeof data.transaction_id!=='string'||!['edit','void'].includes(String(data.action))||typeof data.version!=='string'||!/^\d+$/.test(data.version))throw new ManagementError('unknown');
    return data as unknown as ChangeReceipt;
  }

  async getChangeReceipt(requestId: string): Promise<ChangeReceipt|null> {
    const data=await this.managementRpc('get_transaction_change_receipt',{p_request_id:requestId});
    return data===null?null:this.changeReceipt(data);
  }

  async changeMovement(request: ChangeRequest): Promise<ChangeReceipt> {
    const edit=request.action==='edit',v=request.values;
    const data=await this.managementRpc('manage_transaction_once',{p_request_id:request.requestId,p_transaction_id:request.transactionId,
      p_expected_version:Number(request.expectedVersion),p_action:request.action,p_amount:edit?v.amount:null,p_date:edit?v.date:null,
      p_category:edit?v.category:null,p_from_account:edit?v.from_id:null,p_to_account:edit?v.to_id:null});
    const receipt=this.changeReceipt(data);
    if(receipt.transaction_id!==request.transactionId||receipt.action!==request.action)throw new ManagementError('unknown');
    return receipt;
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
export const supabaseRepository: TransactionRepository & ReconciliationRepository & HistoryRepository & BalancesRepository & ManagementRepository = new SupabaseTransactionRepository();
