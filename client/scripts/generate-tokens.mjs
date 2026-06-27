// Generate CSS custom properties from DESIGN.md (the design-token contract).
// Parses the flat scalar token scales — colors / spacing / rounded — and emits
// src/theme/tokens.css. This keeps the scale tokens in sync with DESIGN.md so
// components reference var(--color-*/--space-*/--radius-*) and never inline
// hex/px. Run: `npm run gen:tokens`.
//
// Nested sections (typography, components) are NOT generated here; their
// derived custom properties live, hand-authored, in src/theme/components.css —
// also part of the token layer.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DESIGN = resolve(here, "../../DESIGN.md");
const OUT = resolve(here, "../src/theme/tokens.css");

// Map a DESIGN.md section name to its CSS custom-property prefix.
const SECTIONS = { colors: "color", spacing: "space", rounded: "radius" };

const src = readFileSync(DESIGN, "utf8");
const lines = src.split(/\r?\n/);

/** Read a flat `name: value` block under a top-level `section:` header. */
function readSection(name) {
  const out = [];
  let inSection = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inSection = line.trimEnd() === `${name}:`;
    else if (inSection) {
      const m = line.match(/^ {2}([\w-]+):\s*"?([^"]+?)"?\s*$/);
      if (m) out.push([m[1], m[2]]);
    }
  }
  return out;
}

let css =
  "/* GENERATED from DESIGN.md by scripts/generate-tokens.mjs — do not edit by hand. */\n" +
  "/* Run `npm run gen:tokens` to regenerate. Token layer: hex/px live here only. */\n\n" +
  ":root {\n";

for (const [section, prefix] of Object.entries(SECTIONS)) {
  const entries = readSection(section);
  if (entries.length === 0) throw new Error(`No tokens found for section "${section}" in DESIGN.md`);
  css += `  /* ${section} */\n`;
  for (const [key, value] of entries) css += `  --${prefix}-${key}: ${value};\n`;
  css += "\n";
}

css += "}\n";

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, css);
console.log(`wrote ${OUT}`);
