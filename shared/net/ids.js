// Room codes and seat tokens.

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L

function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

// A 5-character room code. `rng` (optional) returns numbers in [0, 1) for deterministic tests.
export function makeCode(rng) {
  if (rng) return Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)]).join('');
  const b = randomBytes(5);
  return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

// A seat token: 128 random bits as hex. It is the only proof a returning player has of who they are,
// so it is never sent to anyone but the player it belongs to.
export function makeToken() {
  return Array.from(randomBytes(16), x => x.toString(16).padStart(2, '0')).join('');
}

export const TOKEN_PATTERN = /^[0-9a-f]{16,64}$/;

// Remembers a player's token for one room so a refresh keeps their seat.
// Uses sessionStorage (one tab); falls back to memory where storage is blocked.
export function createTokenStore(gameId, storage) {
  const mem = new Map();
  const st = (() => { try { return storage || globalThis.sessionStorage || null; } catch (e) { return null; } })();
  const key = code => `arcade:${gameId}:token:${code}`;
  return {
    get(code) {
      try { const t = st && st.getItem(key(code)); if (t && TOKEN_PATTERN.test(t)) return t; } catch (e) { /* fall through */ }
      return mem.get(code) || null;
    },
    getOrCreate(code) {
      let t = this.get(code);
      if (!t) { t = makeToken(); mem.set(code, t); try { st && st.setItem(key(code), t); } catch (e) { /* memory only */ } }
      return t;
    },
    forget(code) { mem.delete(code); try { st && st.removeItem(key(code)); } catch (e) { /* ignore */ } },
  };
}
