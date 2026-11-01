import { describe, expect, it } from "vitest";
import { normalizeMfaQr } from "../src/auth/mfa-qr";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="100%"><path fill="#123456" d="M0 0h10v10H0z"/></svg>';
const xml = `<?xml version="1.0"?>\n<!-- QR sintetico -->\n${svg}`;

describe("Normalizzazione del QR TOTP", () => {
  it.each([
    svg,
    xml,
    `\uFEFF  ${xml}`,
    `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${svg}`,
    `data:image/svg+xml;utf-8,${xml}`,
    `data:image/svg+xml;utf-8,${encodeURIComponent(xml)}`,
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`,
    `data:image/svg+xml,${encodeURIComponent(xml)}`,
    `data:image/svg+xml;base64,${btoa(xml)}`,
  ])("conserva la geometria SVG e normalizza il formato valido %#", value => {
    const result = normalizeMfaQr(value);
    expect(result?.startsWith("data:image/svg+xml,")).toBe(true);
    const source = decodeURIComponent(result!.slice("data:image/svg+xml,".length));
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    expect(document.documentElement.localName).toBe("svg");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(document.documentElement.getAttribute("width")).toBe("100%");
    expect(document.querySelector("path")?.getAttribute("fill")).toBe("#123456");
    expect(document.querySelector("path")?.getAttribute("d")).toBe("M0 0h10v10H0z");
    expect(source).not.toContain("<?xml");
    expect(source).not.toContain("<!DOCTYPE");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("decodifica base64 UTF-8 senza alterare il testo", () => {
    const unicodeSvg = svg.replace("<path", "<title>Verifica à</title><path");
    const bytes = new TextEncoder().encode(unicodeSvg);
    const result = normalizeMfaQr(`data:image/svg+xml;charset=utf-8;base64,${btoa(String.fromCharCode(...bytes))}`);
    expect(decodeURIComponent(result!)).toContain("Verifica à");
  });

  it.each([
    undefined, null, {}, "", " ",
    "https://untrusted.example.invalid/qr.svg",
    "javascript:alert(1)",
    `data:text/html,${encodeURIComponent(svg)}`,
    `data:image/png;base64,${btoa(svg)}`,
    `data:image/svg+xml;charset=iso-8859-1,${svg}`,
    "data:image/svg+xml;base64,%%%",
    "data:image/svg+xml,%invalid",
    '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>',
    '<html xmlns="http://www.w3.org/1999/xhtml"/>',
    '<svg xmlns="https://untrusted.example.invalid"/>',
    '<!DOCTYPE svg [<!ENTITY value SYSTEM "https://untrusted.example.invalid/entity">]><svg xmlns="http://www.w3.org/2000/svg">&value;</svg>',
  ])("rifiuta sorgenti non previste o documenti XML non validi %#", value => {
    expect(normalizeMfaQr(value)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
