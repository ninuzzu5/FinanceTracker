import type { CategoryId } from "./categories.js";
import { classificationRules, giftRules, normalizeClassificationText, type ClassificationRule } from "./classification-aliases.js";
import type { TransactionType } from "./types.js";
import { extractTransfer } from "./transfers.js";
import { normalizeText } from "./parser.js";

export type ClassificationSource = "rule" | "unknown";
export interface ClassificationResult {
  type: TransactionType | null;
  category: CategoryId | null;
  confidence: number;
  source: ClassificationSource;
}

interface Match {
  rule: ClassificationRule;
  start: number;
  end: number;
}

function findMatches(text: string, rules: readonly ClassificationRule[]): Match[] {
  const padded = ` ${text} `;
  const matches: Match[] = [];
  for (const rule of rules) {
    for (const alias of rule.aliases) {
      const phrase = ` ${normalizeClassificationText(alias)} `;
      let start = padded.indexOf(phrase);
      while (start !== -1) {
        matches.push({ rule, start, end: start + phrase.length - 1 });
        start = padded.indexOf(phrase, start + 1);
      }
    }
  }
  // A specific expression replaces only contained aliases, not unrelated evidence.
  return matches.filter((match) => !matches.some((other) =>
    other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start));
}

function resolve(matches: Match[]): ClassificationResult {
  const types = new Set(matches.map(({ rule }) => rule.type));
  const categories = new Set(matches.map(({ rule }) => rule.category));
  const type = types.size === 1 ? [...types][0] : null;
  const category = categories.size === 1 ? [...categories][0] : null;
  const complete = type !== null && category !== null;
  return { type, category, confidence: complete ? 0.98 : 0, source: complete ? "rule" : "unknown" };
}

/** Pure rule-based classifier. A future local fallback can consume unknown results. */
export function classifyMessage(input: string): ClassificationResult {
  const transfer = extractTransfer(normalizeText(input));
  if (transfer) {
    const complete = transfer.fromAccount !== null && transfer.toAccount !== null && transfer.fromAccount !== transfer.toAccount;
    return { type: "transfer", category: null, confidence: complete ? 0.98 : 0, source: complete ? "rule" : "unknown" };
  }
  const text = normalizeClassificationText(input);
  const gifts = findMatches(text, giftRules);
  if (gifts.length) return resolve(gifts);
  if (/(?:^| )(?:regalo|regali|regalato)(?: |$)/.test(text)) {
    return { type: null, category: "gifts", confidence: 0, source: "unknown" };
  }
  return resolve(findMatches(text, classificationRules));
}
