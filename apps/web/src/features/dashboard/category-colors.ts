import { expenseCategoryIds } from "@finance-tracker/domain";

// Colore stabile per categoria (non per posizione in classifica): la stessa categoria ha
// sempre lo stesso colore, periodo dopo periodo. Le 8 tinte di marca (theme.css) non bastano
// per le 13 categorie di spesa + "Senza categoria": oltre l'ottava si ripete il colore ma con
// una trama a righe diagonali sopra, cosà la distinzione non dipende solo dal colore.
const palette = ["#E63946", "#1D4ED8", "#2A9D8F", "#FF9F43", "#FF9FB2", "#9CC4FF", "#FFE14D", "#8FE0A8"] as const;
const order: (string | null)[] = [...expenseCategoryIds, null];

export type CategoryStyle = { color: string; hatched: boolean };

export function categoryStyle(category: string | null): CategoryStyle {
  const index = order.indexOf(category);
  const position = index === -1 ? order.length : index;
  return { color: palette[position % palette.length], hatched: position >= palette.length };
}
