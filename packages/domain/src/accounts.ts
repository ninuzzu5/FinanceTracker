import { accountIds, type AccountId } from "./types.js";

// Shared aliases keep ordinary movements and explicit transfer routes consistent.
const accountAliases: Record<AccountId, string> = {
  revolut: "revolut",
  isybank: String.raw`isybank|isy(?:\s+bank)?`,
  contanti: "contanti|cash|liquidi",
};
export const accountPattern = `(?:${accountIds.map(id => accountAliases[id]).join("|")})`;

export function accountIdForAlias(alias: string): AccountId | null {
  return accountIds.find(id => new RegExp(`^(?:${accountAliases[id]})$`, "u").test(alias)) ?? null;
}

export function mentionedAccounts(normalizedText: string): AccountId[] {
  return accountIds.filter(id => new RegExp(
    String.raw`(?<![\p{L}\p{N}_])(?:${accountAliases[id]})(?![\p{L}\p{N}_])`, "u",
  ).test(normalizedText));
}
