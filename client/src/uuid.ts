// newId — a UUIDv4 generator that works in BOTH secure and insecure contexts.
//
// `crypto.randomUUID()` is the stable primitive (AD-4 adopt-stable), but it is
// gated to **secure contexts** only (HTTPS or `localhost`). When the app is
// opened over a LAN IP (e.g. `http://192.168.x.x:8000`, a non-localhost host),
// the context is insecure and `crypto.randomUUID` is `undefined`, so calling it
// threw `crypto.randomUUID is not a function` and every annotation create
// crashed. `crypto.getRandomValues()` is NOT secure-context-gated, so we build a
// v4 UUID from it as the fallback. (No uuid dependency — the standing principle
// is adopt-stable primitives, and Web Crypto is the primitive here.)

/** A UUIDv4 string, sourced from `crypto.randomUUID` when available, else from
 *  `crypto.getRandomValues` (works in insecure contexts), else `Math.random`. */
export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    // Last resort (no Web Crypto at all): non-cryptographic, but never crashes.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1 (RFC 4122)

  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  const h = (i: number) => hex[bytes[i]];
  return (
    h(0) + h(1) + h(2) + h(3) + "-" +
    h(4) + h(5) + "-" +
    h(6) + h(7) + "-" +
    h(8) + h(9) + "-" +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}
