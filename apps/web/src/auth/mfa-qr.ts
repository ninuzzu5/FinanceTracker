export function normalizeMfaQr(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 1_000_000) return null;
  try {
    let svg = value.trim();
    const uri = /^data:image\/svg\+xml((?:;[^,]*)?),([\s\S]*)$/i.exec(svg);
    if (uri) {
      const parameters = uri[1].toLowerCase().split(";").filter(Boolean);
      if (parameters.some(parameter => !["utf-8", "charset=utf-8", "base64"].includes(parameter))) return null;
      const payload = uri[2];
      if (parameters.includes("base64")) {
        const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
        svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } else {
        // Il SDK restituisce XML non codificato; altre risposte possono usare percent-encoding.
        svg = payload.trimStart().startsWith("<") ? payload : decodeURIComponent(payload);
      }
    }
    svg = svg.trim();
    if (!svg.startsWith("<") || /<!ENTITY\b|<!DOCTYPE[^>]*\[/i.test(svg)) return null;
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = document.documentElement;
    if (document.querySelector("parsererror") || root.localName !== "svg"
      || root.namespaceURI !== "http://www.w3.org/2000/svg") return null;
    // Il documento resta separato dal DOM: conserva la radice SVG, senza prologo o DOCTYPE.
    return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  } catch {
    return null;
  }
}
