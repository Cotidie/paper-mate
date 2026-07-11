import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useColumnWidths } from "@/library/useColumnWidths";
import { useTableViewPrefs } from "@/library/tableViewPrefs";

function pointerDownEvent(clientX: number): React.PointerEvent {
  return { clientX, preventDefault: () => {} } as unknown as React.PointerEvent;
}

function dispatchPointer(type: "pointermove" | "pointerup", clientX = 0) {
  document.dispatchEvent(new MouseEvent(type, { clientX }) as unknown as PointerEvent);
}

// `tableViewPrefs` is a `localStorage`-persisted Zustand store (Story 7.10)
// that now seeds `useColumnWidths`'s initial values - reset it between cases
// (mirrors `settings/store.test.ts`) so the defaults stay green with an
// EMPTY persisted store, per test.
beforeEach(() => {
  localStorage.clear();
  useTableViewPrefs.getState().reset();
});

describe("useColumnWidths", () => {
  it("starts at the default width per column (matches the CSS tokens)", () => {
    const { result } = renderHook(() => useColumnWidths());
    expect(result.current.widths).toEqual({
      title: 320,
      authors: 220,
      added: 120,
      file_type: 96,
      location: 140,
      venue_short: 120,
      venue: 200,
      year: 80,
      doi: 200,
    });
  });

  it("dragging one column's handle only changes that column's width", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.startResize("authors", pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 150));
    expect(result.current.widths.authors).toBe(270);
    expect(result.current.widths.title).toBe(320);
    expect(result.current.widths.added).toBe(120);
    expect(result.current.widths.file_type).toBe(96);
    expect(result.current.widths.location).toBe(140);
    expect(result.current.widths.venue_short).toBe(120);
    expect(result.current.widths.venue).toBe(200);
    expect(result.current.widths.year).toBe(80);
    expect(result.current.widths.doi).toBe(200);
  });

  it("clamps each column to its own minimum", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.startResize("file_type", pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", -1000));
    expect(result.current.widths.file_type).toBe(80);
  });

  it("clamps each column to its own maximum", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.startResize("title", pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 5000));
    expect(result.current.widths.title).toBe(640);
  });

  it("ArrowRight widens the given column via keyboard", () => {
    const { result } = renderHook(() => useColumnWidths());
    const right = { key: "ArrowRight", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown("added", right));
    expect(result.current.widths.added).toBe(136);
    expect(result.current.widths.title).toBe(320);
  });
});

describe("useColumnWidths persistence (Story 7.10, AC-3/AC-5)", () => {
  it("a settled drag resize (pointerup) writes the value back to tableViewPrefs", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.startResize("authors", pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 150));
    act(() => dispatchPointer("pointerup"));
    expect(useTableViewPrefs.getState().widths.authors).toBe(270);
  });

  it("a per-frame pointermove does NOT persist - only the settled pointerup value does", () => {
    const { result } = renderHook(() => useColumnWidths());
    act(() => result.current.startResize("authors", pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 150));
    expect(useTableViewPrefs.getState().widths.authors).toBeUndefined();
  });

  it("a keyboard resize step persists immediately (it is already settled)", () => {
    const { result } = renderHook(() => useColumnWidths());
    const right = { key: "ArrowRight", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown("added", right));
    expect(useTableViewPrefs.getState().widths.added).toBe(136);
  });

  it("a fresh useColumnWidths seeds from a persisted width", () => {
    act(() => useTableViewPrefs.getState().setWidth("venue", 333));
    const { result } = renderHook(() => useColumnWidths());
    expect(result.current.widths.venue).toBe(333);
  });
});
