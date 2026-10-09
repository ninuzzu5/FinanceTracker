import type { AccountId, ParsedMessage } from "./types.js";
import { extractDate, stripDateExpressions } from "./dates.js";
import { mentionedAccounts } from "./accounts.js";
import { extractTransfer } from "./transfers.js";

export { extractDate } from "./dates.js";

// Consume whole numeric tokens, including invalid precision/signs, never substrings.
const AMOUNT_PATTERN = /(?<![\p{L}\p{N}_.,/+−-])(?:€\s*|eur\s*)?([+−-]?\d+(?:[.,]\d+)*)(?:\s*(?:€|eur))?(?![\p{L}\p{N}_.,/+−-])/gu;

export interface ParseOptions {
  now?: Date;
  timeZone?: string;
  defaultAccount?: AccountId;
}

export function normalizeText(input: string): string {
  return input
    .trim()
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

export function extractAmount(normalizedText: string): number | null {
  const matches = [...stripDateExpressions(normalizedText).matchAll(AMOUNT_PATTERN)];
  if (matches.length !== 1 || !/^\d{1,7}(?:[.,]\d{1,2})?$/.test(matches[0][1])) return null;
  const amount = Number(matches[0][1].replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Validate a standalone value in a field-edit prompt, without accepting prose. */
export function parseAmountInput(input: string): number | null {
  const text = normalizeText(input);
  const matches = [...text.matchAll(AMOUNT_PATTERN)];
  return matches.length === 1 && matches[0][0] === text ? extractAmount(text) : null;
}

export function parseDateInput(input: string, now = new Date(), timeZone = "Europe/Rome"): string | null {
  return extractDate(normalizeText(input), now, timeZone, true);
}

export function extractAccount(
  normalizedText: string,
  defaultAccount: AccountId = "revolut",
): AccountId | null {
  const accounts = mentionedAccounts(normalizedText);
  return accounts.length > 1 ? null : accounts[0] ?? defaultAccount;
}

export function parseMessage(input: string, options: ParseOptions = {}): ParsedMessage {
  const normalizedText = normalizeText(input);

  return {
    originalText: input,
    normalizedText,
    amount: extractAmount(normalizedText),
    date: extractDate(normalizedText, options.now, options.timeZone),
    ...(extractTransfer(normalizedText) ?? { type: null, account: extractAccount(normalizedText, options.defaultAccount) }),
  };
}
