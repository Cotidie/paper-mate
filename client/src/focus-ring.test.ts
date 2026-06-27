// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// AC-5: a 2px {colors.ink} focus ring on keyboard focus for all chrome.
// jsdom does not compute :focus-visible styles, so assert the global contract.
const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

describe("global focus ring", () => {
  it("defines a :focus-visible outline from the ink + ring-width tokens", () => {
    const rule = css.slice(css.indexOf(":focus-visible"));
    expect(rule).toContain(":focus-visible");
    expect(rule).toContain("var(--focus-ring-width)");
    expect(rule).toContain("var(--color-ink)");
  });
});
