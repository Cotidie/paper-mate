import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragResize } from "@/library/useDragResize";

function pointerDownEvent(clientX: number): React.PointerEvent {
  return { clientX, preventDefault: () => {} } as unknown as React.PointerEvent;
}

function dispatchPointer(type: "pointermove" | "pointerup", clientX = 0) {
  document.dispatchEvent(new MouseEvent(type, { clientX }) as unknown as PointerEvent);
}

describe("useDragResize", () => {
  it("starts at the given initial value", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    expect(result.current.value).toBe(100);
  });

  it("drag right increases the value by the pointer delta", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    act(() => result.current.startResize(pointerDownEvent(50)));
    act(() => dispatchPointer("pointermove", 80));
    expect(result.current.value).toBe(130);
  });

  it("drag left decreases the value by the pointer delta", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    act(() => result.current.startResize(pointerDownEvent(50)));
    act(() => dispatchPointer("pointermove", 20));
    expect(result.current.value).toBe(70);
  });

  it("clamps to the minimum", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    act(() => result.current.startResize(pointerDownEvent(50)));
    act(() => dispatchPointer("pointermove", -1000));
    expect(result.current.value).toBe(0);
  });

  it("clamps to the maximum", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    act(() => result.current.startResize(pointerDownEvent(50)));
    act(() => dispatchPointer("pointermove", 5000));
    expect(result.current.value).toBe(200);
  });

  it("stops tracking after pointerup", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    act(() => result.current.startResize(pointerDownEvent(50)));
    act(() => dispatchPointer("pointerup"));
    act(() => dispatchPointer("pointermove", 150));
    expect(result.current.value).toBe(100);
  });

  it("two independent instances track separately (no shared module state)", () => {
    const a = renderHook(() => useDragResize(100, 0, 200));
    const b = renderHook(() => useDragResize(50, 0, 200));
    act(() => a.result.current.startResize(pointerDownEvent(0)));
    act(() => dispatchPointer("pointermove", 40));
    expect(a.result.current.value).toBe(140);
    expect(b.result.current.value).toBe(50);
  });

  it("ArrowRight increases by the step, ArrowLeft decreases by it", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200, 10));
    const right = { key: "ArrowRight", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    const left = { key: "ArrowLeft", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown(right));
    expect(result.current.value).toBe(110);
    act(() => result.current.handleKeyDown(left));
    act(() => result.current.handleKeyDown(left));
    expect(result.current.value).toBe(90);
  });

  it("keyboard step also clamps", () => {
    const { result } = renderHook(() => useDragResize(5, 0, 200, 10));
    const left = { key: "ArrowLeft", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown(left));
    expect(result.current.value).toBe(0);
  });

  it("ignores unrelated keys", () => {
    const { result } = renderHook(() => useDragResize(100, 0, 200));
    const other = { key: "Enter", preventDefault: () => {} } as unknown as React.KeyboardEvent;
    act(() => result.current.handleKeyDown(other));
    expect(result.current.value).toBe(100);
  });
});
