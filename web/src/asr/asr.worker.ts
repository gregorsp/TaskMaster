import { fromUrls, type ParakeetModel } from "parakeet.js";

interface LoadMessage {
  type: "load";
  id: number;
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
  threads: number;
  wasmPaths: string;
}

interface TranscribeMessage {
  type: "transcribe";
  id: number;
  pcm: Float32Array;
}

type Incoming = LoadMessage | TranscribeMessage;

let model: ParakeetModel | null = null;
let loading: Promise<ParakeetModel> | null = null;

const post = (message: unknown) => (self as unknown as { postMessage: (m: unknown) => void }).postMessage(message);

async function loadModel(message: LoadMessage): Promise<ParakeetModel> {
  if (model) return model;
  if (!loading) {
    loading = fromUrls({
      encoderUrl: message.encoderUrl,
      decoderUrl: message.decoderUrl,
      tokenizerUrl: message.tokenizerUrl,
      backend: "wasm",
      cpuThreads: message.threads,
      wasmPaths: message.wasmPaths,
      preprocessorBackend: "js",
    });
  }
  model = await loading;
  return model;
}

self.addEventListener("message", (event: MessageEvent<Incoming>) => {
  const message = event.data;

  if (message.type === "load") {
    loadModel(message)
      .then(() => post({ type: "loaded", id: message.id }))
      .catch((error: unknown) => post({ type: "error", id: message.id, error: String(error) }));
    return;
  }

  if (message.type === "transcribe") {
    void (async () => {
      try {
        if (!model) throw new Error("Modell ist noch nicht geladen");
        const result = await model.transcribeLongAudio(message.pcm, 16_000, {
          returnTimestamps: "word",
          chunkLengthS: 60,
        });
        post({
          type: "result",
          id: message.id,
          text: result.text,
          chunks: result.chunks ?? [],
          words: result.words ?? [],
        });
      } catch (error) {
        post({ type: "error", id: message.id, error: String(error) });
      }
    })();
  }
});
