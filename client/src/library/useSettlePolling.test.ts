import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettlePolling } from "@/library/useSettlePolling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSettlePolling", () => {
  it("polls on an interval until isSettled, then stops", async () => {
    // n goes 0,1,2,...; settled once n >= 2.
    let n = 0;
    const fetch = vi.fn(async () => ({ n: n++ }));
    const onResult = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useSettlePolling({
        fetch,
        isSettled: (r: { n: number }) => r.n >= 2,
        onResult,
        onSettled,
        intervalMs: 1000,
        maxPolls: 60,
      }),
    );

    act(() => result.current.start());
    expect(fetch).not.toHaveBeenCalled(); // first tick only after the interval

    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith({ n: 0 });

    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onSettled).not.toHaveBeenCalled();

    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenLastCalledWith({ n: 2 });

    // Settled: no further polling however long we wait.
    await act(async () => void (await vi.advanceTimersByTimeAsync(10000)));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops after maxPolls even if never settled, firing onMaxPolls not onSettled", async () => {
    const last = { ok: false, tag: "last" };
    const fetch = vi.fn(async () => last);
    const onSettled = vi.fn();
    const onMaxPolls = vi.fn();
    const { result } = renderHook(() =>
      useSettlePolling({
        fetch,
        isSettled: () => false,
        onResult: vi.fn(),
        onSettled,
        onMaxPolls,
        intervalMs: 1000,
        maxPolls: 3,
      }),
    );

    act(() => result.current.start());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10000)));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(onSettled).not.toHaveBeenCalled(); // cap is not a settle
    expect(onMaxPolls).toHaveBeenCalledTimes(1);
    expect(onMaxPolls).toHaveBeenLastCalledWith(last); // hands over the last result
  });

  it("fires onMaxPolls(null) when the cap is reached via a failing fetch", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const onMaxPolls = vi.fn();
    const { result } = renderHook(() =>
      useSettlePolling({
        fetch,
        isSettled: () => false,
        onResult: vi.fn(),
        onMaxPolls,
        intervalMs: 1000,
        maxPolls: 2,
      }),
    );

    act(() => result.current.start());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10000)));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onMaxPolls).toHaveBeenCalledTimes(1);
    expect(onMaxPolls).toHaveBeenLastCalledWith(null); // no result on a failed fetch
  });

  it("stop() halts further polling", async () => {
    const fetch = vi.fn(async () => ({ ok: false }));
    const { result } = renderHook(() =>
      useSettlePolling({
        fetch,
        isSettled: () => false,
        onResult: vi.fn(),
        intervalMs: 1000,
        maxPolls: 60,
      }),
    );

    act(() => result.current.start());
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => result.current.stop());
    await act(async () => void (await vi.advanceTimersByTimeAsync(10000)));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a second start() while polling is a no-op (no doubled timers)", async () => {
    const fetch = vi.fn(async () => ({ ok: false }));
    const { result } = renderHook(() =>
      useSettlePolling({
        fetch,
        isSettled: () => false,
        onResult: vi.fn(),
        intervalMs: 1000,
        maxPolls: 60,
      }),
    );

    act(() => result.current.start());
    act(() => result.current.start()); // ignored — rides the existing loop
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(fetch).toHaveBeenCalledTimes(1); // one tick, not two
  });
});
