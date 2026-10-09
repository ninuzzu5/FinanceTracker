import { accountIds, amountInCents, expenseCategoryIds, incomeCategoryIds, type AccountId, type TransactionDraft } from "@finance-tracker/domain";

export type PersistenceErrorCode = "currency" | "conflict" | "closed" | "configuration" | "authentication" | "session" | "accounts_query" | "account_missing" | "mapping" | "insert" | "constraint" | "rls";
export class PersistenceError extends Error {
  constructor(readonly code: PersistenceErrorCode) { super(`Transaction persistence failed: ${code}`); }
}
export interface AccountRow { id: string; user_id: string; name: string; currency: string; is_active: boolean }
export interface TransactionPayload {
  user_id: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  transaction_date: string;
  category: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
}
export interface TransactionRepository {
  saveTransaction(transaction: TransactionDraft, requestId: string): Promise<{ id: string }>;
  getTransactionReceipt(requestId: string): Promise<{ id: string } | null>;
}

export function mapTransaction(transaction: TransactionDraft, userId: string, accounts: AccountRow[]): TransactionPayload {
  const { amount, date, type } = transaction;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!userId || amountInCents(amount) === null || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new PersistenceError("mapping");
  const resolve = (account: AccountId | null): string => {
    if (!account || !accountIds.includes(account)) throw new PersistenceError("mapping");
    const matches = accounts.filter(row => row.user_id === userId && row.is_active === true && row.name.trim().toLowerCase() === account);
    if (matches.length !== 1 || !matches[0].id) throw new PersistenceError("account_missing");
    if (matches[0].currency !== "EUR") throw new PersistenceError("currency");
    return matches[0].id;
  };
  const base = { user_id: userId, type, amount, transaction_date: date };
  if (type === "transfer") {
    if (!transaction.fromAccount || transaction.fromAccount === transaction.toAccount) throw new PersistenceError("mapping");
    const from = resolve(transaction.fromAccount), to = resolve(transaction.toAccount);
    if (from === to) throw new PersistenceError("mapping");
    return { ...base, type, category: null, from_account_id: from, to_account_id: to };
  }
  if (type !== "expense" && type !== "income") throw new PersistenceError("mapping");
  const categories: readonly string[] = type === "expense" ? expenseCategoryIds : incomeCategoryIds;
  if (!transaction.category || !categories.includes(transaction.category)) throw new PersistenceError("mapping");
  const account = resolve(transaction.account);
  return { ...base, type, category: transaction.category, from_account_id: type === "expense" ? account : null, to_account_id: type === "income" ? account : null };
}

export function persistenceMessage(error: unknown): string {
  const code = error instanceof PersistenceError ? error.code : "insert";
  if (code === "currency") return "FinanceTracker supporta soltanto conti in EUR. Controlla la valuta del conto: non è stata effettuata alcuna conversione.";
  if (code === "conflict") return "Questa operazione è già stata registrata con valori diversi. Non ho creato un nuovo movimento; recupera la ricevuta dal vecchio pulsante Conferma.";
  if (code === "closed") return "La giornata Contanti è già riconciliata. Il movimento richiede una riapertura, non ancora disponibile.";
  if (code === "account_missing") return "Bro, il conto richiesto non è disponibile nel database. Controlla i conti prima di riprovare.";
  if (code === "configuration" || code === "authentication" || code === "session") return "Bro, non riesco ad accedere al database. Controlla la configurazione del bot prima di riprovare.";
  if (code === "mapping" || code === "constraint") return "Bro, il database non accetta questi dati. Controlla la proposta prima di riprovare.";
  if (code === "rls") return "Bro, il database non autorizza il salvataggio. Controlla i permessi prima di riprovare.";
  return "Esito del salvataggio incerto. Riprova Conferma: mantiene la stessa chiave e recupera una ricevuta già salvata. Annulla chiude solo il flusso.";
}
