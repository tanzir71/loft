import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const version = "v1";
const keyInfo = Buffer.from("TutorLoft encrypted settings");

function requireSecret(secret: string | undefined) {
  const normalized = secret?.trim();

  if (!normalized) {
    throw new Error("Encryption secret is required.");
  }

  return normalized;
}

function deriveKey(secret: string, salt: Buffer) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), salt, keyInfo, 32));
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptSecret(value: string, secret = process.env.AUTH_SECRET) {
  const normalizedSecret = requireSecret(secret);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(normalizedSecret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [version, encode(salt), encode(iv), encode(tag), encode(ciphertext)].join(".");
}

export function decryptSecret(payload: string, secret = process.env.AUTH_SECRET) {
  try {
    const normalizedSecret = requireSecret(secret);
    const [payloadVersion, encodedSalt, encodedIv, encodedTag, encodedCiphertext] =
      payload.split(".");

    if (
      payloadVersion !== version ||
      !encodedSalt ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext
    ) {
      throw new Error("Invalid encrypted payload.");
    }

    const salt = decode(encodedSalt);
    const iv = decode(encodedIv);
    const tag = decode(encodedTag);
    const ciphertext = decode(encodedCiphertext);
    const key = deriveKey(normalizedSecret, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt secret.");
  }
}
