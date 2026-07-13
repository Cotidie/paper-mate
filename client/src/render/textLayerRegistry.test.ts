// Registry-level bookkeeping is jsdom-safe (no real selection geometry
// needed): `isEmptyLayerSpace` is pure target classification over the
// layer↔bound map. The controller's live-selection behavior (snap, copy,
// lifecycle) is covered in textSelection.test.ts.

import { describe, it, expect } from "vitest";
import { isEmptyLayerSpace } from "./textLayerRegistry";

describe("isEmptyLayerSpace", () => {
  it("is true for the registered .textLayer container element itself", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(div, textLayers)).toBe(true);
  });

  it("is true for the layer's endOfContent child", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    div.append(endOfContent);
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(endOfContent, textLayers)).toBe(true);
  });

  it("is false for a glyph span descendant of the layer", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "NYU v2.";
    div.append(span, endOfContent);
    const textLayers = new Map([[div, endOfContent]]);
    expect(isEmptyLayerSpace(span, textLayers)).toBe(false);
  });

  it("is false for an unrelated/unregistered element", () => {
    const div = document.createElement("div");
    const endOfContent = document.createElement("div");
    const textLayers = new Map([[div, endOfContent]]);
    const other = document.createElement("div");
    expect(isEmptyLayerSpace(other, textLayers)).toBe(false);
  });

  it("is false for a null target", () => {
    expect(isEmptyLayerSpace(null, new Map())).toBe(false);
  });
});
