const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/1/o/0 for readable codes

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Opaque id, 16 chars, URL safe. */
export function newId(prefix = ""): string {
  const bytes = randomBytes(16);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${s}` : s;
}

/** Human room code like "kqz-7rm-p2d" (9 chars, readable aloud). */
export function roomCode(): string {
  const bytes = randomBytes(9);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3, 6)}-${chars.slice(6, 9)}`;
}

export function normaliseCode(input: string): string {
  const raw = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw.length !== 9) return raw;
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`;
}

export function isRoomCode(input: string): boolean {
  return /^[a-km-np-z2-9]{3}-[a-km-np-z2-9]{3}-[a-km-np-z2-9]{3}$/.test(input);
}

/** "Acme Sprint · Q3!" → "acme-sprint-q3" */
export function slugify(input: string, max = 40): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}
