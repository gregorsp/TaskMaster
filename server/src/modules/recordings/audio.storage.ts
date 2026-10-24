import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

/**
 * Harte Obergrenze pro Aufnahme.
 * 128 MB decken bei 128 kbit/s etwa 2,3 Stunden – eine 90-Minuten-Session
 * passt damit bequem hinein.
 */
export const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

export function ensureAudioDir(): void {
  if (!existsSync(config.audioDir)) {
    mkdirSync(config.audioDir, { recursive: true });
  }
}

export function audioFilePath(filename: string): string {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw Object.assign(new Error("Invalid audio filename"), { statusCode: 400, code: "INVALID_PATH" });
  }
  const resolved = path.join(config.audioDir, filename);
  if (!resolved.startsWith(config.audioDir)) {
    throw Object.assign(new Error("Invalid audio filename"), { statusCode: 400, code: "INVALID_PATH" });
  }
  return resolved;
}

export function createAudioFile(filename: string): void {
  ensureAudioDir();
  writeFileSync(audioFilePath(filename), Buffer.alloc(0));
}

export function appendAudioChunk(filename: string, chunk: Buffer): number {
  const filePath = audioFilePath(filename);
  appendFileSync(filePath, chunk);
  return statSync(filePath).size;
}

export function audioFileSize(filename: string): number {
  const filePath = audioFilePath(filename);
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

export function deleteAudioFile(filename: string): void {
  try {
    const filePath = audioFilePath(filename);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Aufräumfehler dürfen das Löschen der Notiz nicht blockieren.
  }
}
