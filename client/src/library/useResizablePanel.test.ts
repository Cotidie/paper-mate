import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResizablePanel } from "@/library/useResizablePanel";

function pointerDownEvent(clientX: number): React.PointerEvent {
  return { clientX, preventDefault: () => {} } as unknown as React.PointerEvent;
}

function dispatchPointer(type: "pointermove" | "pointerup", clientX = 0) {
  document.dispatchEvent(new MouseEvent(type, { clientX }) as unknown as PointerEvent);
}

describe("useResizablePanel", () => {
  it("starts at the default width", () => {
    const { result } = renderHook(() => useResizablePanel());
    expect(result.current.width).toBe(280);
  });

  it("drag right widens the panel by the pointer delta", () => {
    const { result } = renderHook(() => useResizablePanel());
    act(() => result.current.startResize(pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 150));
    expect(result.current.width).toBe(330);
  });

  it("drag left narrows the panel by the pointer delta", () => {
    const { result } = renderHook(() => useResizablePanel());
    act(() => result.current.startResize(pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 60));
    expect(result.current.width).toBe(240);
  });

  it("clamps to the minimum width", () => {
    const { result } = renderHook(() => useResizablePanel());
    act(() => result.current.startResize(pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", -1000));
    expect(result.current.width).toBe(result.current.minWidth);
  });

  it("clamps to the maximum width", () => {
    const { result } = renderHook(() => useResizablePanel());
    act(() => result.current.startResize(pointerDownEvent(100)));
    act(() => dispatchPointer("pointermove", 5000));
    expect(result.current.width).toBe(result.current.maxWidth);
  });

  it("stops tracking after pointerup", () => {
    const { result } = renderHook(() => useResizablePanel());
    act(() => result.current.startResize(pointerDownEvent(100)));
    act(() => dispatchPointer("pointerup"));
    act(() => dispatchPointer("pointermove", 300));
    expect(result.current.width).toBe(280);
  });

  it("ArrowRight widens by the keyboard step, ArrowLeft narrows it", () => {
    const { result } = renderHook(() => useResizablePanel());
    const right = { key: "ArrowRight", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    const left = { key: "ArrowLeft", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown(right));
    expect(result.current.width).toBe(296);
    act(() => result.current.handleKeyDown(left));
    act(() => result.current.handleKeyDown(left));
    expect(result.current.width).toBe(264);
  });

  it("ignores unrelated keys", () => {
    const { result } = renderHook(() => useResizablePanel());
    const other = { key: "Enter", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown(other));
    expect(result.current.width).toBe(280);
  });
});
