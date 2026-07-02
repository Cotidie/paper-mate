import { describe, it, expect, afterEach, vi } from "vitest";
import { newId } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newId", () => {
  it("uses crypto.randomUUID when available (secure context)", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: vi.fn() });
    expect(newId()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalled();
  });

  it("falls back to getRandomValues when randomUUID is missing (insecure context)", () => {
    // Insecure context (e.g. served over a LAN IP): randomUUID is undefined, but
    // getRandomValues still works. Must NOT throw, must produce a valid v4 UUID.
    const getRandomValues = vi.fn((a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = (i * 37) & 0xff;
      return a;
    });
    vi.stubGlobal("crypto", { getRandomValues }); // no randomUUID
    const id = newId();
    expect(getRandomValues).toHaveBeenCalled();
    expect(id).toMatch(V4); // version nibble = 4, variant = 8..b
  });

  it("produces distinct ids across calls in the fallback path", () => {
    let seed = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (seed++ * 7) & 0xff;
        return a;
      },
    });
    expect(newId()).not.toBe(newId());
  });

  it("last-resort path (no Web Crypto at all) still returns a valid v4 shape", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newId()).toMatch(V4);
  });
});
