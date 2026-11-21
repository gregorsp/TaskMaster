import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Kleine Verschlüsselungs-Hilfe für sensible Nutzer-Einstellungen
 * (derzeit nur der KI-API-Schlüssel). Der Schlüssel wird aus dem JWT_SECRET
 * abgeleitet – rotiert das Secret, müssen die Schlüssel neu hinterlegt werden.
 *
 * Format: base64(iv).base64(authTag).base64(ciphertext)
 */
function deriveKey(): Buffer {
  return createHash("sha256").update(`${config.jwtSecret}:taskmaster-ai-key-v1`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [ivB64, tagB64, ciphertextB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ciphertextB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
