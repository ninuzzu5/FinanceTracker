import { accountIdForAlias, accountPattern, mentionedAccounts } from "./accounts.js";
import type { TransferFields } from "./types.js";

const account = accountPattern;
const side = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?<direction>da|a)\s+(?<account>${account})(?![\p{L}\p{N}_])`, "gu");
const route = new RegExp(String.raw`(?<![\p{L}\p{N}_])da\s+(${account})\s+a\s+(${account})(?![\p{L}\p{N}_])`, "u");

/** No default/inferred counterparty, including partial directional input. Text is normalized by the caller. */
export function extractTransfer(normalizedText: string): TransferFields | null {
  const sides = [...normalizedText.matchAll(side)];
  const marker = /\btrasferimento\b/u.test(normalizedText);
  if (!sides.length && !marker) return null;
  const from = sides.filter((m) => m.groups?.direction === "da");
  const to = sides.filter((m) => m.groups?.direction === "a");
  const complete = route.test(normalizedText);
  // Every account mention must belong to a directional side. Extra counterparties or
  // alternatives (including aliases of an existing side) require clarification.
  const extraAccounts = mentionedAccounts(normalizedText.replace(side, " "));
  // Multiple routes or disconnected mentions are ambiguous; do not silently choose one.
  if (extraAccounts.length > 0 || from.length > 1 || to.length > 1 || (from.length && to.length && !complete)) {
    return { type: "transfer", fromAccount: null, toAccount: null };
  }
  return {
    type: "transfer",
    fromAccount: from.length === 1 ? accountIdForAlias(from[0].groups!.account) : null,
    toAccount: to.length === 1 ? accountIdForAlias(to[0].groups!.account) : null,
  };
}
