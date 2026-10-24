const HF_BASE = "https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx/resolve/main";
const MODEL_ROOT = "taskmaster-models";
const MODEL_NAME = "parakeet-int8";

const FILES = [
  { key: "encoder", fileName: "encoder-model.int8.onnx", url: `${HF_BASE}/encoder-model.int8.onnx` },
  { key: "decoder", fileName: "decoder_joint-model.int8.onnx", url: `${HF_BASE}/decoder_joint-model.int8.onnx` },
  { key: "tokenizer", fileName: "vocab.txt", url: `${HF_BASE}/vocab.txt` },
] as const;

export const MODEL_DOWNLOAD_BYTES = 671_000_000;

export interface ModelStatus {
  ready: boolean;
  bytes: number;
}

export interface ModelProgress {
  receivedBytes: number;
  totalBytes: number;
  file: string;
}

async function modelDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  const models = await root.getDirectoryHandle(MODEL_ROOT, { create });
  return models.getDirectoryHandle(MODEL_NAME, { create });
}

export async function getModelStatus(): Promise<ModelStatus> {
  try {
    const directory = await modelDirectory(false);
    if (!directory) return { ready: false, bytes: 0 };
    let bytes = 0;
    for (const file of FILES) {
      const handle = await directory.getFileHandle(file.fileName).catch(() => null);
      if (!handle) return { ready: false, bytes };
      const stored = await handle.getFile();
      bytes += stored.size;
    }
    return { ready: true, bytes };
  } catch {
    return { ready: false, bytes: 0 };
  }
}

export async function downloadModel(onProgress?: (progress: ModelProgress) => void): Promise<void> {
  const directory = await modelDirectory(true);
  if (!directory) throw new Error("Der Browser unterstützt keinen lokalen Modellspeicher");

  await navigator.storage?.persist?.().catch(() => false);

  for (const file of FILES) {
    const existing = await directory.getFileHandle(file.fileName).catch(() => null);
    if (existing) {
      const stored = await existing.getFile();
      if (stored.size > 0) continue;
    }

    const response = await fetch(file.url);
    if (!response.ok || !response.body) {
      throw new Error(`Download fehlgeschlagen: ${file.fileName} (${response.status})`);
    }

    const totalBytes = Number(response.headers.get("content-length") ?? 0);
    const handle = await directory.getFileHandle(file.fileName, { create: true });
    const writable = await handle.createWritable();
    const reader = response.body.getReader();
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      receivedBytes += value.byteLength;
      onProgress?.({ receivedBytes, totalBytes, file: file.fileName });
    }
    await writable.close();
  }
}

export interface ModelUrls {
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
}

export async function getModelUrls(): Promise<ModelUrls> {
  const directory = await modelDirectory(false);
  if (!directory) throw new Error("Modellspeicher nicht verfügbar");

  const urls: Record<string, string> = {};
  for (const file of FILES) {
    const handle = await directory.getFileHandle(file.fileName);
    const stored = await handle.getFile();
    urls[file.key] = URL.createObjectURL(stored);
  }

  return {
    encoderUrl: urls.encoder,
    decoderUrl: urls.decoder,
    tokenizerUrl: urls.tokenizer,
  };
}

export async function deleteModel(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle(MODEL_ROOT, { create: false });
    await models.removeEntry(MODEL_NAME, { recursive: true });
  } catch {
    // Nichts zu löschen.
  }
}
