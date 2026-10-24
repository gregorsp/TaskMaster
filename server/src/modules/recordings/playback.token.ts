import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";

const PLAYBACK_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * `<audio src>` kann keinen Authorization-Header senden. Statt das ganze File
 * durch fetch zu ziehen (bei 20 Minuten Audio mehrere Megabyte im Speicher),
 * bekommt der Player eine kurzlebige signierte URL.
 */
function sign(payload: string): string {
  return createHmac("sha256", config.jwtSecret).update(payload).digest("hex");
}

export interface PlaybackTokenPayload {
  recordingId: string;
  userId: string;
  expiresAt: number;
}

export function createPlaybackToken(recordingId: string, userId: string, now = Date.now()): string {
  const expiresAt = now + PLAYBACK_TOKEN_TTL_MS;
  const payload = `${recordingId}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function parsePlaybackToken(token: string, now = Date.now()): PlaybackTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [recordingId, userId, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!recordingId || !userId || !Number.isFinite(expiresAt) || expiresAt < now) return null;

  const expected = Buffer.from(sign(`${recordingId}.${userId}.${expiresAt}`), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  return { recordingId, userId, expiresAt };
}

export const PLAYBACK_TOKEN_TTL = PLAYBACK_TOKEN_TTL_MS;
