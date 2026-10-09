import type { AccountId, ParsedMessage } from "./types.js";
import { extractDate, stripDateExpressions } from "./dates.js";
import { mentionedAccounts } from "./accounts.js";
import { extractTransfer } from "./transfers.js";

export { extractDate } from "./dates.js";

// Consume the entire monetary token before validation, including signs around currency.
// Include common Unicode minus/dash forms so none can expose a positive substring.
const MONEY_SIGNS = String.raw`+\u2212\u2010-\u2015\uFE63\uFF0D\u207B\u208B\u2796\u00B1-`;
const sign = String.raw`[${MONEY_SIGNS}][\uFE0E\uFE0F]?`;
const AMOUNT_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.,/${MONEY_SIGNS}\uFE0E\uFE0F])` +
  String.raw`(?<prefix>(?:${sign}\s*)*(?:(?:€|eur)\s*(?:${sign}\s*)*)?)` +
  String.raw`(?<value>\d+(?:[.,]\d+)*)` +
  String.raw`(?<suffix>(?:\s*(?:€|eur))?(?:\s*${sign})*)` +
  String.raw`(?![\p{L}\p{N}_.,/${MONEY_SIGNS}\uFE0E\uFE0F])`, "gu",
);
const SIGN_PATTERN = new RegExp(`[${MONEY_SIGNS}]`, "u");

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
  if (matches.length !== 1) return null;
  const { prefix, value, suffix } = matches[0].groups!;
  if (SIGN_PATTERN.test(prefix + suffix) || !/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) return null;
  const amount = Number(value.replace(",", "."));
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
