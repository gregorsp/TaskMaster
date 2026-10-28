import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../../../config.js";

/**
 * Parakeet-TDT 0.6B v3 (int8) – dieselben Dateien, die auch der Browser lädt.
 * Größen und SHA-256 stammen aus der Hugging-Face-API (LFS-OIDs des Repos
 * `ysdede/parakeet-tdt-0.6b-v3-onnx`); `vocab.txt` ist kein LFS-Objekt, sein
 * Hash wurde einmalig heruntergeladen und geprüft.
 */
const HF_BASE = "https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx/resolve/main";

export interface ModelFileSpec {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

export const MODEL_FILES: ModelFileSpec[] = [
  {
    name: "encoder-model.int8.onnx",
    url: `${HF_BASE}/encoder-model.int8.onnx`,
    sha256: "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09",
    bytes: 652_183_999,
  },
  {
    name: "decoder_joint-model.int8.onnx",
    url: `${HF_BASE}/decoder_joint-model.int8.onnx`,
    sha256: "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70",
    bytes: 18_202_004,
  },
  {
    name: "vocab.txt",
    url: `${HF_BASE}/vocab.txt`,
    sha256: "ba8e4007c65f4bb4358ffe2ecc13d9ccc7a10351151065242b5c3a943e685742",
    bytes: 102_132,
  },
];

export const MODEL_TOTAL_BYTES = MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0);

export function modelDir(): string {
  return path.join(config.modelsDir, "parakeet-tdt-0.6b-v3-int8");
}

export function modelPath(fileName: string): string {
  return path.join(modelDir(), fileName);
}

export interface ModelStatus {
  present: boolean;
  bytes: number;
  files: Array<{ name: string; present: boolean; bytes: number }>;
}

export function modelStatus(): ModelStatus {
  const files = MODEL_FILES.map((file) => {
    const target = modelPath(file.name);
    const present = existsSync(target);
    return { name: file.name, present, bytes: present ? statSync(target).size : 0 };
  });
  return {
    present: files.every((file) => file.present),
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function downloadAndVerify(file: ModelFileSpec, log: (message: string) => void): Promise<void> {
  const target = modelPath(file.name);
  const temp = `${target}.part`;

  log(`Modell: lade ${file.name} (${(file.bytes / 1_048_576).toFixed(0)} MB)`);
  const response = await fetch(file.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download von ${file.name} fehlgeschlagen: HTTP ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temp));

  const digest = await sha256OfFile(temp);
  if (digest !== file.sha256) {
    rmSync(temp, { force: true });
    throw new Error(`Prüfsumme von ${file.name} stimmt nicht (${digest})`);
  }

  renameSync(temp, target);
  log(`Modell: ${file.name} in Ordnung`);
}

/**
 * Stellt sicher, dass alle Modelldateien vorhanden und unverändert sind.
 * Fehlende Dateien werden geladen; eine vorhandene Datei mit falscher Prüfsumme
 * wird verworfen und neu geladen.
 */
export async function ensureModel(log: (message: string) => void = () => {}): Promise<void> {
  mkdirSync(modelDir(), { recursive: true });

  for (const file of MODEL_FILES) {
    const target = modelPath(file.name);
    if (existsSync(target) && statSync(target).size === file.bytes) {
      const digest = await sha256OfFile(target);
      if (digest === file.sha256) continue;
      log(`Modell: ${file.name} ist beschädigt, lade neu`);
      rmSync(target, { force: true });
    }
    await downloadAndVerify(file, log);
  }
}
