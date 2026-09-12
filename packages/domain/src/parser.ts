import type { AccountId, ParsedMessage } from "./types.js";

const AMOUNT_PATTERN = /(?:^|\s)(\d{1,7}(?:[.,]\d{1,2})?)(?:\s*(?:€|eur))?(?=\s|$)/i;
const EXPLICIT_DATE_PATTERN = /\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])(?:[/-](\d{2}|\d{4}))?\b/;

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
    .replace(/\s+/g, " ");
}

export function extractAmount(normalizedText: string): number | null {
  const withoutDates = normalizedText.replace(EXPLICIT_DATE_PATTERN, " ");
  const match = withoutDates.match(AMOUNT_PATTERN);

  if (!match) return null;

  const amount = Number(match[1].replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function extractAccount(
  normalizedText: string,
  defaultAccount: AccountId = "revolut",
): AccountId {
  if (/\b(?:isy|isybank)\b/.test(normalizedText)) return "isybank";
  if (/\brevolut\b/.test(normalizedText)) return "revolut";
  return defaultAccount;
}

function datePartsInTimeZone(now: Date, timeZone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return [value("year"), value("month"), value("day")];
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractDate(
  normalizedText: string,
  now = new Date(),
  timeZone = "Europe/Rome",
): string {
  const explicit = normalizedText.match(EXPLICIT_DATE_PATTERN);
  const [currentYear, currentMonth, currentDay] = datePartsInTimeZone(now, timeZone);

  if (explicit) {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]);
    const rawYear = explicit[3];
    const year = rawYear
      ? rawYear.length === 2
        ? 2000 + Number(rawYear)
        : Number(rawYear)
      : currentYear;
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    ) {
      return formatDate(year, month, day);
    }
  }

  if (/\bieri\b/.test(normalizedText)) {
    const yesterday = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay - 1));
    return formatDate(
      yesterday.getUTCFullYear(),
      yesterday.getUTCMonth() + 1,
      yesterday.getUTCDate(),
    );
  }

  return formatDate(currentYear, currentMonth, currentDay);
}

export function parseMessage(input: string, options: ParseOptions = {}): ParsedMessage {
  const normalizedText = normalizeText(input);

  return {
    originalText: input,
    normalizedText,
    amount: extractAmount(normalizedText),
    date: extractDate(normalizedText, options.now, options.timeZone),
    account: extractAccount(normalizedText, options.defaultAccount),
  };
}
