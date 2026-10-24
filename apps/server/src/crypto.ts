// Square access and refresh tokens are encrypted at rest with AES-256-GCM. The stored bytes are
// nonce (12) || ciphertext || tag (16). The row id and column are bound in as associated data, so a
// ciphertext copied onto another row (or another column) fails to decrypt instead of being accepted.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Keyring = { current: number; keys: ReadonlyMap<number, Buffer> };

export function keyFromBase64(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("An encryption key must decode to exactly 32 bytes.");
  return key;
}

/** The current key, plus the previous one while tokens are being re-encrypted after a rotation. */
export function keyringFrom(c: { TOKEN_ENCRYPTION_KEY: string; TOKEN_KEY_VERSION: number; TOKEN_ENCRYPTION_KEY_PREVIOUS?: string | undefined }): Keyring {
  const keys = new Map<number, Buffer>([[c.TOKEN_KEY_VERSION, keyFromBase64(c.TOKEN_ENCRYPTION_KEY)]]);
  if (c.TOKEN_ENCRYPTION_KEY_PREVIOUS && c.TOKEN_KEY_VERSION > 1) keys.set(c.TOKEN_KEY_VERSION - 1, keyFromBase64(c.TOKEN_ENCRYPTION_KEY_PREVIOUS));
  return { current: c.TOKEN_KEY_VERSION, keys };
}

export class TokenCipher {
  readonly version: number;
  readonly #keys: ReadonlyMap<number, Buffer>;

  constructor(ring: Keyring) {
    if (!ring.keys.has(ring.current)) throw new Error("The current key version has no key.");
    this.version = ring.current;
    this.#keys = ring.keys;
  }

  encrypt(plaintext: string, aad: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#keys.get(this.version)!, nonce);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  decrypt(stored: Buffer, aad: string, version: number): string {
    const key = this.#keys.get(version);
    if (!key) throw new Error(`No key for version ${version}.`);
    if (stored.length < 12 + 16) throw new Error("Stored token is too short.");
    const nonce = stored.subarray(0, 12);
    const tag = stored.subarray(stored.length - 16);
    const body = stored.subarray(12, stored.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }
}

export const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();

/** A URL-safe random secret (invitation links, OAuth state). Store only its sha256. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export function hmacBase64(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
