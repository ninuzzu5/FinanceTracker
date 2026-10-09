import { randomBytes, randomUUID } from "node:crypto";
import { expenseCategoryIds, incomeCategoryIds, type CategoryId, type TransactionType, type TransactionDraft } from "@finance-tracker/domain";
import { sourceOperationKey } from "./operation-key.js";
import type { ReconciliationState } from "./reconciliation.js";
import type { MenuState, WizardState } from "./wizard-state.js";

export type ProposalValues = TransactionDraft;

export type Proposal = ProposalValues & {
  id: string;
  requestId: string;
  submitted: boolean;
  uncertainOutcome?: boolean;
  revision: number;
  sourceMessageId: number | null;
  expiresAt: number;
  editing: "amount" | "date" | null;
};

export function categoriesFor(type: TransactionType | null): readonly CategoryId[] {
  return type === "expense" ? expenseCategoryIds : type === "income" ? incomeCategoryIds : [];
}

export type ConversationState = { kind: "proposal"; proposal: Proposal } | WizardState | MenuState | ReconciliationState;

/** One active menu, wizard or proposal per chat; a shared expiry and no raw messages. */
export class ProposalStore {
  private readonly entries = new Map<number, { state: ConversationState; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly ttlMs = 30 * 60_000, private readonly clock = Date.now) {}

  get(chatId: number): Proposal | undefined {
    const state = this.getState(chatId);
    return state?.kind === "proposal" ? state.proposal : undefined;
  }

  getState(chatId: number): ConversationState | undefined {
    const entry = this.entries.get(chatId);
    if (entry && entry.expiresAt <= this.clock()) this.remove(chatId);
    return this.entries.get(chatId)?.state;
  }

  private put(chatId: number, state: ConversationState): void {
    this.remove(chatId);
    const timer = setTimeout(() => this.remove(chatId), this.ttlMs);
    timer.unref();
    this.entries.set(chatId, { state, expiresAt: this.clock() + this.ttlMs, timer });
  }

  openMenu(chatId: number, sourceMessageId?: number): MenuState {
    const state: MenuState = { kind: "menu", id: randomBytes(8).toString("hex"), requestId: sourceMessageId === undefined ? randomUUID() : sourceOperationKey(chatId, sourceMessageId) };
    this.put(chatId, state);
    return state;
  }

  startReconciliation(chatId: number): ReconciliationState {
    const state: ReconciliationState = { kind: "reconciliation", id: randomBytes(8).toString("hex"), requestId: randomUUID(), revision: 0, step: "date", date: null, accountId: null, theoretical: null, observed: null };
    this.put(chatId, state);
    return state;
  }

  startWizard(chatId: number, mode: "movement" | "transfer"): WizardState {
    const previous = this.getState(chatId);
    const state: WizardState = {
      kind: "wizard", id: randomBytes(8).toString("hex"), requestId: previous?.kind === "menu" ? previous.requestId : randomUUID(), revision: 0,
      step: mode === "movement" ? "type" : "amount", history: [],
      values: mode === "movement"
        ? { mode, type: null, amount: null, date: null, account: null, category: null }
        : { mode, type: "transfer", amount: null, date: null, fromAccount: null, toAccount: null },
    };
    this.put(chatId, state);
    return state;
  }

  create(chatId: number, sourceMessageId: number | null, values: ProposalValues, requestId?: string): Proposal {
    const proposal: Proposal = {
      ...values, id: randomBytes(8).toString("hex"), revision: 0, sourceMessageId,
      requestId: sourceMessageId === null ? requestId ?? randomUUID() : sourceOperationKey(chatId, sourceMessageId), submitted: false,
      expiresAt: this.clock() + this.ttlMs, editing: null,
    };
    this.put(chatId, { kind: "proposal", proposal });
    return proposal;
  }

  remove(chatId: number): void {
    const entry = this.entries.get(chatId);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(chatId);
  }

  replaceValues(chatId: number, values: ProposalValues): Proposal {
    const current = this.get(chatId);
    if (!current) throw new Error("Proposta scaduta.");
    const { id, requestId, submitted, uncertainOutcome, revision, sourceMessageId, expiresAt, editing } = current;
    const proposal: Proposal = { ...values, id, requestId, submitted, uncertainOutcome, revision, sourceMessageId, expiresAt, editing };
    this.entries.get(chatId)!.state = { kind: "proposal", proposal };
    return proposal;
  }

  clear(): void {
    for (const chatId of this.entries.keys()) this.remove(chatId);
  }
}
