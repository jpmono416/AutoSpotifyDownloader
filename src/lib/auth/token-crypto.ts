import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export interface EncryptedTokenPayload { ciphertext: string; iv: string; tag: string; keyVersion: number }

function encryptionKey(): Buffer {
  const configured = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("TOKEN_ENCRYPTION_KEY is required to store provider tokens.");
  const decoded = /^[0-9a-f]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return decoded;
}

export function encryptToken(value: string): EncryptedTokenPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), keyVersion: Number(process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1") };
}

export function decryptToken(payload: EncryptedTokenPayload): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function encryptionKeyFingerprint(): string {
  return createHash("sha256").update(encryptionKey()).digest("hex").slice(0, 12);
}
