// ULID spec: https://github.com/ulid/spec (48-bit time, 80-bit randomness,
// Crockford base32, monotonic within the same millisecond).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_LENGTH = 16;

function encodeTime(timeMs: number): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 2 ** 48 - 1) {
    throw new RangeError("ULID time must be a 48-bit non-negative integer");
  }
  let time = "";
  let remaining = timeMs;
  for (let index = 0; index < 10; index += 1) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  return time;
}

function randomDigits(): number[] {
  const bytes = new Uint8Array(RANDOM_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte % 32);
}

function increment(digits: number[]): number[] {
  const next = [...digits];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index] < 31) {
      next[index] += 1;
      return next;
    }
    next[index] = 0;
  }
  throw new RangeError(
    "ULID random component overflowed within one millisecond",
  );
}

export function createUlidFactory() {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return (timeMs: number = Date.now()): string => {
    if (timeMs <= lastTime) {
      lastRandom = increment(lastRandom);
    } else {
      lastTime = timeMs;
      lastRandom = randomDigits();
    }
    return (
      encodeTime(lastTime) + lastRandom.map((digit) => ALPHABET[digit]).join("")
    );
  };
}

export const ulid = createUlidFactory();

export function ulidTime(id: string): number {
  let time = 0;
  for (const char of id.slice(0, 10)) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Not a ULID: ${id}`);
    time = time * 32 + value;
  }
  return time;
}
