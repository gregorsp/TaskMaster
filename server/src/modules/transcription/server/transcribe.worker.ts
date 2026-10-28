import { cpus } from "node:os";
import { parentPort } from "node:worker_threads";
import { decodeToMono16k } from "./decode.js";
import { ParakeetRuntime } from "./parakeet.js";
import { buildSegments } from "./segments.js";

/**
 * Worker-Thread des nächtlichen Laufs: dekodiert die Aufnahme und transkribiert
 * sie. Der Thread fasst die Datenbank nicht an – er bekommt einen Dateipfad und
 * liefert Segmente zurück. So bleibt die Event-Loop des HTTP-Servers frei und
 * ein hängender Job lässt sich hart abbrechen (`worker.terminate()`).
 */

interface TranscribeMessage {
  type: "transcribe";
  id: number;
  filePath: string;
  mimeType: string;
  durationMs: number;
}

const port = parentPort;
if (!port) throw new Error("transcribe.worker muss als Worker laufen");

const runtime = new ParakeetRuntime();

port.on("message", (message: TranscribeMessage) => {
  if (message?.type !== "transcribe") return;

  void (async () => {
    try {
      if (!runtime.loaded) {
        // Ein Kern bleibt für den HTTP-Server frei.
        await runtime.load(Math.max(1, cpus().length - 1));
        port.postMessage({ type: "loaded" });
      }

      const { pcm } = await decodeToMono16k(message.filePath, message.mimeType);
      const { words, text } = await runtime.transcribe(pcm, (progressMs) => {
        port.postMessage({ type: "progress", id: message.id, progressMs });
      });

      port.postMessage({
        type: "result",
        id: message.id,
        segments: buildSegments(words, [], text, message.durationMs),
      });
    } catch (error) {
      port.postMessage({
        type: "error",
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});

// Der Hauptthread wartet auf diese Meldung, bevor er Arbeit schickt.
port.postMessage({ type: "ready" });
