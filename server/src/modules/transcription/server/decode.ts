import { readFile } from "node:fs/promises";
import { Decoder, tools, type EBMLElementDetail } from "ts-ebml";
import { OpusDecoder } from "opus-decoder";
import { OggOpusDecoder } from "ogg-opus-decoder";

/**
 * Dekodiert eine Aufnahme zu mono 16 kHz Float32 – die Eingabe der ASR.
 *
 * Der Server speichert Audio unverändert (ADR 0002) und hat kein ffmpeg: die
 * Dateien von `MediaRecorder` sind deshalb WebM/Opus (Chrome, Android) oder
 * Ogg/Opus (Firefox), ohne korrekte Dauer im Container. Beides wird hier per
 * WASM dekodiert; AAC/M4A (Safari) wird bewusst nicht unterstützt.
 */

export const TARGET_SAMPLE_RATE = 16_000;

/** Mehr als das lässt der nächtliche Lauf nicht zu – Speicher und Zeit auf dem Pi. */
export const MAX_SERVER_AUDIO_MS = 3 * 60 * 60_000;

const FRAME_BATCH = 500;

export function isSupportedAudio(mimeType: string, fileName: string): boolean {
  const haystack = `${mimeType} ${fileName}`.toLowerCase();
  return haystack.includes("ogg") || haystack.includes("webm");
}

function unsupported(reason: string) {
  return Object.assign(new Error(reason), { statusCode: 415, code: "UNSUPPORTED_AUDIO" });
}

function downmix(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 0) return new Float32Array(0);
  if (channelData.length === 1) return channelData[0];

  const length = channelData[0].length;
  const mono = new Float32Array(length);
  for (const channel of channelData) {
    const limit = Math.min(length, channel.length);
    for (let i = 0; i < limit; i++) mono[i] += channel[i] / channelData.length;
  }
  return mono;
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Track-Nummer der Opus-Spur aus den `Tracks`-Metadaten, sonst null. */
function findAudioTrack(elements: EBMLElementDetail[]): number | null {
  const entries = elements.filter(
    (element) => element.name === "TrackEntry" && element.type === "m" && !(element as { isEnd?: boolean }).isEnd
  );

  for (const entry of entries) {
    const children = elements.filter(
      (element) =>
        element !== entry &&
        element.dataStart >= entry.dataStart &&
        element.dataEnd <= entry.dataEnd
    );
    const codec = children.find((element) => element.name === "CodecID");
    const number = children.find((element) => element.name === "TrackNumber");
    if (codec && number && String((codec as { value?: unknown }).value).startsWith("A_OPUS")) {
      return Number((number as { value?: unknown }).value);
    }
  }

  // Kein CodecID gefunden (z. B. abgeschnittene Metadaten): bei genau einer
  // Spur ist die Wahl eindeutig.
  return entries.length === 1 ? Number((elements.find((e) => e.name === "TrackNumber") as { value?: unknown })?.value) : null;
}

async function decodeWebm(buffer: Buffer, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const elements = new Decoder().decode(arrayBuffer as ArrayBuffer);
  const trackNumber = findAudioTrack(elements);

  const frames: Uint8Array[] = [];
  for (const element of elements) {
    if (element.name !== "SimpleBlock") continue;
    // SimpleBlock ist ein Binär-Element; der Typ vereinigt Master- und
    // Werte-Elemente, deshalb der Cast.
    const payload = (element as { data?: Buffer }).data;
    if (!payload) continue;
    const block = tools.readBlock(payload as unknown as ArrayBuffer);
    if (trackNumber !== null && block.trackNumber !== trackNumber) continue;
    for (const frame of block.frames) frames.push(new Uint8Array(frame));
  }

  if (frames.length === 0) throw unsupported("In der WebM-Datei steckt kein Opus-Audio");

  const decoder = new OpusDecoder({ sampleRate: TARGET_SAMPLE_RATE });
  await decoder.ready;

  const chunks: Float32Array[] = [];
  try {
    for (let index = 0; index < frames.length; index += FRAME_BATCH) {
      const result = decoder.decodeFrames(frames.slice(index, index + FRAME_BATCH));
      const mono = downmix(result.channelData);
      if (mono.length > 0) chunks.push(mono);
      onProgress?.(Math.min(1, (index + FRAME_BATCH) / frames.length));
    }
  } finally {
    decoder.free();
  }

  return concat(chunks);
}

async function decodeOgg(buffer: Buffer, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  // Die Typen von ogg-opus-decoder kennen `sampleRate` nicht, die
  // Implementierung wertet es aus (8/12/16/24/48 kHz).
  const decoder = new OggOpusDecoder({ sampleRate: TARGET_SAMPLE_RATE } as never);
  await decoder.ready;

  try {
    const result = await (decoder as unknown as {
      decodeFile: (data: Uint8Array) => Promise<{ channelData: Float32Array[] }>;
    }).decodeFile(new Uint8Array(buffer));
    onProgress?.(1);
    return downmix(result.channelData);
  } finally {
    decoder.free();
  }
}

export interface DecodeResult {
  pcm: Float32Array;
  sampleRate: number;
}

export async function decodeToMono16k(
  filePath: string,
  mimeType: string,
  onProgress?: (fraction: number) => void
): Promise<DecodeResult> {
  if (!isSupportedAudio(mimeType, filePath)) {
    throw unsupported(`Nicht unterstütztes Audioformat für die Server-Transkription: ${mimeType}`);
  }

  const buffer = await readFile(filePath);
  const isOgg = `${mimeType} ${filePath}`.toLowerCase().includes("ogg");
  const pcm = isOgg ? await decodeOgg(buffer, onProgress) : await decodeWebm(buffer, onProgress);

  if (pcm.length === 0) throw unsupported("Die Aufnahme enthält kein dekodierbares Audio");

  return { pcm, sampleRate: TARGET_SAMPLE_RATE };
}
