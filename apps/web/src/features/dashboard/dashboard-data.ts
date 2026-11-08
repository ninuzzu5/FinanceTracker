import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCents, type Balance, type Movement, type Period } from "./dashboard-model";

export class DashboardAccessError extends Error {}

const pageSize = 50;
const invalidData = () => new Error("Risposta contabile non valida");
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const nullableId = (value: unknown): value is string | null => value === null || typeof value === "string" && uuid.test(value);

function responseRows(result: { data: unknown; status: number; error: { code: string } | null }): Record<string, unknown>[] {
  if (result.status === 401 || result.status === 403 || result.error?.code === "42501") throw new DashboardAccessError();
  if (result.error || !Array.isArray(result.data)
    || result.data.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw invalidData();
  return result.data;
}

async function balances(client: SupabaseClient, date: string, signal: AbortSignal): Promise<Balance[]> {
  const result = await client.rpc("get_dashboard_balances", { p_as_of: date }, { get: true, count: "exact" })
    .abortSignal(signal);
  const rows = responseRows(result);
  if (result.count !== rows.length) throw invalidData();
  const seen = new Set<string>();
  return rows.map(row => {
    const { account_id: id, account_name: name, is_active: active, status, balance } = row;
    if (typeof id !== "string" || !uuid.test(id) || seen.has(id) || typeof name !== "string" || typeof active !== "boolean"
      || row.currency !== "EUR" || row.as_of_date !== date
      || (status !== "configured" && status !== "before_opening" && status !== "not_configured")
      || (status !== "configured" && balance !== null)) throw invalidData();
    seen.add(id);
    return { id, name, active, status, cents: status === "configured" ? parseCents(balance) : null };
  });
}

async function movements(client: SupabaseClient, period: Period, signal: AbortSignal): Promise<Movement[]> {
  const all: Movement[] = [];
  const seen = new Set<string>();
  let previous: Movement | undefined;
  for (;;) {
    signal.throwIfAborted();
    const result = await client.rpc("get_dashboard_movements", {
      p_from: period.from, p_to: period.to, p_limit: pageSize,
      ...(previous ? { p_before_date: previous.date, p_before_id: previous.id } : {}),
    }, { get: true }).abortSignal(signal);
    signal.throwIfAborted();
    const page = responseRows(result);
    // Una pagina corta può dipendere dal limite della Data API. Solo una pagina vuota chiude la lettura.
    if (page.length === 0) return all;
    for (const row of page) {
      const { id, type, transaction_date: date, category, from_account_id: from, to_account_id: to, voided } = row;
      if (typeof id !== "string" || !uuid.test(id) || seen.has(id) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || date < period.from || date > period.to || (previous && (date > previous.date || date === previous.date && id >= previous.id))
        || (type !== "expense" && type !== "income" && type !== "transfer") || (category !== null && typeof category !== "string")
        || !nullableId(from) || !nullableId(to) || typeof voided !== "boolean") throw invalidData();
      const cents = parseCents(row.amount);
      if (cents <= 0n) throw invalidData();
      seen.add(id);
      previous = { id, type, date, category, from, to, voided, cents };
      all.push(previous);
    }
  }
}

export async function loadDashboard(client: SupabaseClient, period: Period, signal: AbortSignal) {
  signal.throwIfAborted();
  const [accounts, entries] = await Promise.all([balances(client, period.to, signal), movements(client, period, signal)]);
  signal.throwIfAborted();
  return { accounts, entries };
}
