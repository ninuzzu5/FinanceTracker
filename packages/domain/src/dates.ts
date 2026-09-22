const months = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];
const weekdays = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];

// Longest expressions first: "l'altro ieri" must not become just "ieri".
// The same tokens are removed before extracting money amounts.
const expressionPattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/\-])(?:` + [
    String.raw`\d{4,}-\d{1,2}-\d{1,2}`,
    String.raw`\d{1,2}[/-]\d{1,2}(?:[/-]\d+)?`,
    String.raw`\d{1,2}\s+(?:${months.join("|")})(?:\s+\d{4})?`,
    String.raw`-?\d+\s+giorni\s+fa`,
    String.raw`una\s+settimana\s+fa`,
    String.raw`(?:l'\s*)?altro\s+ieri|avantieri|oggi|ieri`,
    String.raw`(?:${weekdays.join("|")})(?:\s+(?:scorso|prossimo))?`,
  ].join("|") + String.raw`)(?![\p{L}\p{N}_/\-])`, "gu",
);

export function stripDateExpressions(text: string): string {
  return text.replace(expressionPattern, " ");
}

function calendarDate(year: number, month: number, day: number): Date | null {
  // setUTCFullYear avoids JavaScript's special interpretation of years 0..99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (year < 1 || year > 9999 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function referenceDate(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return calendarDate(part("year"), part("month"), part("day"))!;
}

function shiftDays(date: Date, days: number): Date | null {
  if (!Number.isSafeInteger(days)) return null;
  const shifted = new Date(date);
  // Calendar arithmetic, not elapsed hours: safe across DST changes.
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return Number.isFinite(shifted.getTime()) && shifted.getUTCFullYear() >= 1 && shifted.getUTCFullYear() <= 9999
    ? shifted : null;
}

function resolveExpression(text: string, today: Date): Date | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?$/.exec(text);
  if (numeric) {
    const year = numeric[4] ? Number(numeric[4]) + (numeric[4].length === 2 ? 2000 : 0) : today.getUTCFullYear();
    return calendarDate(year, Number(numeric[3]), Number(numeric[1]));
  }
  const written = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(text);
  if (written && months.includes(written[2])) {
    return calendarDate(written[3] ? Number(written[3]) : today.getUTCFullYear(), months.indexOf(written[2]) + 1, Number(written[1]));
  }
  if (text === "oggi") return today;
  if (text === "ieri") return shiftDays(today, -1);
  if (/^(?:l'\s*)?altro ieri$/.test(text) || text === "avantieri") return shiftDays(today, -2);
  if (text === "una settimana fa") return shiftDays(today, -7);
  const daysAgo = /^(\d+) giorni fa$/.exec(text);
  if (daysAgo) return shiftDays(today, -Number(daysAgo[1]));
  const [weekday, qualifier] = text.split(" ");
  const target = weekdays.indexOf(weekday);
  if (target !== -1) {
    if (qualifier === "prossimo") return shiftDays(today, (target - today.getUTCDay() + 7) % 7 || 7);
    const distance = (today.getUTCDay() - target + 7) % 7;
    return shiftDays(today, -(qualifier === "scorso" ? distance || 7 : distance));
  }
  return null;
}

export function extractDate(normalizedText: string, now = new Date(), timeZone = "Europe/Rome", requireDateOnly = false): string | null {
  const today = referenceDate(now, timeZone);
  const expressions = [...normalizedText.matchAll(expressionPattern)];
  if (requireDateOnly && (expressions.length !== 1 || expressions[0][0] !== normalizedText)) return null;
  if (expressions.length > 1) return null;
  const date = expressions.length ? resolveExpression(expressions[0][0], today) : today;
  return date ? date.toISOString().slice(0, 10) : null;
}
