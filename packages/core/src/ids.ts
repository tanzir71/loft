const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/1/o/0 for readable ids
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // room codes: no I/L/O/0/1, read aloud easily

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

let lastMs = 0;
let counter = 0;
/**
 * Time-sortable id: 9-char base36 ms timestamp + 3-char counter + 8 random chars.
 * Ids made later in the same tab always sort after earlier ones, even within one millisecond.
 */
export function sortableId(prefix = ""): string {
  const now = Date.now();
  if (now === lastMs) counter++;
  else {
    lastMs = now;
    counter = 0;
  }
  const rand = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
  const id = now.toString(36).padStart(9, "0") + counter.toString(36).padStart(3, "0") + rand;
  return prefix ? `${prefix}_${id}` : id;
}

/** Human room code like "K7P-42Q" (Figma 07 · Join with code). */
export function roomCode(): string {
  const bytes = randomBytes(6);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3, 6)}`;
}

/** "k7p 42q", "K7P42Q" or a full room link → "K7P-42Q". Returns the cleaned input when it can't be a code. */
export function normaliseCode(input: string): string {
  const fromLink = input.match(/\/r\/([A-Za-z0-9-]+)/)?.[1] ?? input;
  const raw = fromLink.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 6) return raw;
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}`;
}

export function isRoomCode(input: string): boolean {
  return /^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/.test(input);
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
