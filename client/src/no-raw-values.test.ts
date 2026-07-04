// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// AC-4 / design rule: component styles reference DESIGN.md tokens and never
// inline raw hex or px. The token layer (src/theme/**) and the GENERATED API
// schema are exempt; px lives only in the token layer.
const SRC = fileURLToPath(new URL(".", import.meta.url));

const EXEMPT = (rel: string) =>
  rel.startsWith("theme/") || rel.endsWith("schema.d.ts") || /\.test\.[tj]sx?$/.test(rel);

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(full));
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const PX = /\b\d+px\b/;

describe("no raw hex/px in component styles", () => {
  const files = collect(SRC).filter((f) => !EXEMPT(relative(SRC, f)));

  it("scans at least the reader component styles", () => {
    expect(files.some((f) => f.endsWith("ReaderPage.css"))).toBe(true);
  });

  for (const file of files) {
    const rel = relative(SRC, file);
    it(`has no raw hex/px: ${rel}`, () => {
      // Strip comments (px/hex mentioned in prose are not style values).
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const lines = text.split(/\r?\n/);
      const offenders = lines
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => HEX.test(l) || PX.test(l));
      expect(offenders.map((o) => `${o.i}: ${o.l.trim()}`)).toEqual([]);
    });
  }
});
