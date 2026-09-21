import type { ClassifiedMovement } from "./categories.js";
import { normalizeText } from "./parser.js";

// Separate from parsing normalization: punctuation carries meaning in amounts/dates.
export function normalizeClassificationText(input: string): string {
  return normalizeText(input).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type ClassificationRule = ClassifiedMovement & { aliases: readonly string[] };

export const classificationRules: readonly ClassificationRule[] = [
  { type: "expense", category: "groceries", aliases: ["supermercato", "spesa", "conad", "coop", "lidl", "eurospin", "alimentari", "prodotti per la casa"] },
  { type: "expense", category: "public_transport", aliases: ["autobus", "bus", "metro", "treno", "taxi", "uber"] },
  { type: "expense", category: "flights", aliases: ["volo", "aereo", "ryanair", "easyjet", "biglietto aereo", "volo per vacanza"] },
  { type: "expense", category: "tobacco", aliases: ["tabacco", "tabaccaio", "sigarette", "camel", "iqos"] },
  { type: "expense", category: "sport", aliases: ["palestra", "piscina", "calcetto", "padel", "abbonamento palestra", "abbonamento in palestra", "abbonamento piscina"] },
  { type: "expense", category: "leisure", aliases: ["cinema", "discoteca", "serata", "uscita"] },
  { type: "expense", category: "food", aliases: ["pranzo", "cena", "ristorante", "pizzeria", "bar", "mc", "mcdonald", "mcdonald's", "delivery", "deliveroo", "justeat", "just eat", "spesa al ristorante"] },
  { type: "expense", category: "rent", aliases: ["affitto", "canone di locazione"] },
  { type: "expense", category: "personal_care", aliases: ["barbiere", "parrucchiere", "estetista", "cosmetici"] },
  { type: "expense", category: "subscriptions", aliases: ["netflix", "spotify", "abbonamento", "icloud"] },
  { type: "expense", category: "holidays", aliases: ["hotel", "albergo", "vacanza", "booking"] },
  { type: "expense", category: "unexpected", aliases: ["emergenza", "riparazione imprevista"] },
  { type: "income", category: "salary", aliases: ["stipendio", "paga", "busta paga"] },
  { type: "income", category: "personal_projects", aliases: ["progetto personale", "freelance", "consulenza", "pagamento cliente", "lavoretto"] },
];

// Directional gift context takes precedence over the object bought/received.
export const giftRules: readonly ClassificationRule[] = [
  { type: "expense", category: "gifts", aliases: ["regalo per", "regali per", "comprato regalo", "comprato un regalo", "acquistato regalo", "acquistato un regalo"] },
  { type: "income", category: "gifts", aliases: ["regalo ricevuto", "regali ricevuti", "mi hanno regalato", "regalo da", "regali da"] },
];
