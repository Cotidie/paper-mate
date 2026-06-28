import { describe, it, expect } from "vitest";
import { canonicalize, normalizeRect, denormalizeRect, pickPage, type PageBox } from "./index";

const box: PageBox = { width: 600, height: 800 };

describe("canonicalize", () => {
  it("orders a negative drag so x0<=x1, y0<=y1", () => {
    expect(canonicalize(100, 200, 40, 50)).toEqual({ x0: 40, y0: 50, x1: 100, y1: 200 });
  });
  it("leaves an already-canonical rect unchanged", () => {
    expect(canonicalize(10, 20, 30, 40)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
  });
});

describe("normalizeRect", () => {
  it("normalizes a card-local rect to [0,1] fractions of box*scale", () => {
    // At scale 1 the card is 600x800; a 0..300 x, 0..400 y rect → 0.5, 0.5.
    expect(normalizeRect({ x0: 0, y0: 0, x1: 300, y1: 400 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.5,
      y1: 0.5,
    });
  });
  it("removes scale so the same PDF region normalizes identically at any zoom", () => {
    const at1 = normalizeRect({ x0: 60, y0: 80, x1: 300, y1: 400 }, box, 1);
    // Same PDF region at 2x is twice the pixels; must normalize to the same fractions.
    const at2 = normalizeRect({ x0: 120, y0: 160, x1: 600, y1: 800 }, box, 2);
    expect(at2).toEqual(at1);
  });
  it("canonicalizes a negative drag before normalizing", () => {
    expect(normalizeRect({ x0: 300, y0: 400, x1: 0, y1: 0 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0.5,
      y1: 0.5,
    });
  });
  it("clamps overshoot back into [0,1] (sub-pixel selection past the card edge)", () => {
    // A rect a few px past the 600x800 card → fractions just over 1 → clamped.
    expect(normalizeRect({ x0: -2, y0: -3, x1: 606, y1: 808 }, box, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
    });
  });

  it("guards divide-by-zero on a zero-size box", () => {
    expect(normalizeRect({ x0: 1, y0: 1, x1: 2, y1: 2 }, { width: 0, height: 0 }, 1)).toEqual({
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
    });
  });
});

describe("normalize ↔ denormalize round-trip (AC-6 anchor fidelity)", () => {
  it("denormalize is the inverse of normalize at the same scale", () => {
    const local = { x0: 60, y0: 80, x1: 360, y1: 480 };
    const norm = normalizeRect(local, box, 1);
    expect(denormalizeRect(norm, box, 1)).toEqual({ left: 60, top: 80, width: 300, height: 400 });
  });
  it("re-derives a larger screen box when scale grows (zoom)", () => {
    const norm = normalizeRect({ x0: 60, y0: 80, x1: 360, y1: 480 }, box, 1);
    const at1 = denormalizeRect(norm, box, 1);
    const at2 = denormalizeRect(norm, box, 2);
    // Position + size scale exactly with zoom — the anchor stays put in PDF space.
    expect(at2).toEqual({ left: at1.left * 2, top: at1.top * 2, width: at1.width * 2, height: at1.height * 2 });
  });
});

describe("pickPage (two-page split logic, AC-5)", () => {
  const cards = [
    { left: 0, top: 0, right: 600, bottom: 800 },
    { left: 0, top: 820, right: 600, bottom: 1620 },
  ];
  it("assigns a rect to the card containing its midpoint", () => {
    expect(pickPage({ left: 10, top: 10, right: 50, bottom: 30 }, cards)).toBe(0);
    expect(pickPage({ left: 10, top: 900, right: 50, bottom: 920 }, cards)).toBe(1);
  });
  it("returns -1 for a rect in the gutter between cards", () => {
    expect(pickPage({ left: 10, top: 805, right: 50, bottom: 815 }, cards)).toBe(-1);
  });
  it("splits a two-card selection: top rects → card 0, bottom rects → card 1", () => {
    const rects = [
      { left: 10, top: 700, right: 200, bottom: 720 },
      { left: 10, top: 840, right: 200, bottom: 860 },
    ];
    const assigned = rects.map((r) => pickPage(r, cards));
    expect(assigned).toEqual([0, 1]);
  });
});
