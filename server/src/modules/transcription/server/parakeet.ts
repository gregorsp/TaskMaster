import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-node";
import { JsPreprocessor } from "parakeet.js/mel";
import { modelPath } from "./modelStore.js";
import type { TranscriptWord } from "./segments.js";

/**
 * Parakeet-TDT 0.6B v3 (int8) in Node.
 *
 * Es gibt keine Node-Fassung des Client-Codes: `parakeet.js` lädt sein Modell
 * per `fetch` und spricht onnxruntime-web. Deshalb hier nur der reine
 * Vorverarbeitungsteil (MIT, `parakeet.js/mel`, identisch zum Client) plus
 * derselbe Greedy-TDT-Dekoder wie im Client – nachgebaut nach
 * `parakeet.js/src/parakeet.js` (`_runCombinedStep`, Frame-Vorrücken, Wortbau).
 * Weicht etwas ab, weicht das Transkript ab; die Tests prüfen deshalb die
 * Segmentierung, nicht die Zahlen.
 */

const BLANK_TOKEN = "<blk>";
const SPACE_MARK = "\u2581";

/** Encoder-Unterabtastung × Fensterschritt = 80 ms pro Encoder-Frame. */
const SUBSAMPLING = 8;
const WINDOW_STRIDE_S = 0.01;
const TIME_STRIDE_S = SUBSAMPLING * WINDOW_STRIDE_S;

const MAX_TOKENS_PER_STEP = 10;
const PRED_HIDDEN = 640;
const PRED_LAYERS = 2;
const MEL_BINS = 128;

export interface Tokenizer {
  id2token: string[];
  blankId: number;
}

export interface ParakeetResult {
  text: string;
  words: TranscriptWord[];
}

function loadTokenizer(): Tokenizer {
  const lines = readFileSync(modelPath("vocab.txt"), "utf8").split(/\r?\n/);
  const id2token: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const [token, id] = line.split(/\s+/);
    const index = Number(id);
    if (!token || !Number.isInteger(index)) continue;
    id2token[index] = token;
  }
  const blankId = id2token.findIndex((token) => token === BLANK_TOKEN);
  return { id2token, blankId: blankId === -1 ? id2token.length - 1 : blankId };
}

export class ParakeetRuntime {
  private encoder: ort.InferenceSession | null = null;
  private joiner: ort.InferenceSession | null = null;
  private tokenizer: Tokenizer | null = null;
  private preprocessor = new JsPreprocessor({ nMels: MEL_BINS });

  get loaded(): boolean {
    return this.encoder !== null && this.joiner !== null && this.tokenizer !== null;
  }

  async load(threads: number): Promise<void> {
    if (this.loaded) return;

    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ["cpu"],
      intraOpNumThreads: threads,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
    };

    this.tokenizer = loadTokenizer();
    this.encoder = await ort.InferenceSession.create(modelPath("encoder-model.int8.onnx"), options);
    this.joiner = await ort.InferenceSession.create(modelPath("decoder_joint-model.int8.onnx"), options);
  }

  async dispose(): Promise<void> {
    await this.encoder?.release();
    await this.joiner?.release();
    this.encoder = null;
    this.joiner = null;
    this.tokenizer = null;
  }

  /**
   * Greedy-TDT-Dekodierung: pro Encoder-Frame ein Schritt durch Decoder+Joiner,
   * Vorrücken um die vorhergesagte Dauer. Bricht nie ab – `t` steigt spätestens
   * nach `MAX_TOKENS_PER_STEP` Token oder einem Blank-Frame.
   */
  async transcribe(
    pcm: Float32Array,
    onProgress?: (progressMs: number) => void
  ): Promise<ParakeetResult> {
    if (!this.encoder || !this.joiner || !this.tokenizer) throw new Error("Modell ist nicht geladen");

    const { features, length } = this.preprocessor.process(pcm);
    const frames = Math.floor(features.length / MEL_BINS);
    if (frames === 0 || length === 0) return { text: "", words: [] };

    const encoderOutputs = await this.encoder.run({
      audio_signal: new ort.Tensor("float32", features, [1, MEL_BINS, frames]),
      length: new ort.Tensor("int64", BigInt64Array.from([BigInt(length)]), [1]),
    });

    const encoded = encoderOutputs["outputs"] as ort.Tensor;
    const dims = encoded.dims as readonly number[];
    const hidden = dims[1];
    const encodedFrames = dims[2];
    const encodedData = encoded.data as Float32Array;

    const { id2token, blankId } = this.tokenizer;
    const vocabSize = id2token.length;

    let state1 = new Float32Array(PRED_LAYERS * PRED_HIDDEN);
    let state2 = new Float32Array(PRED_LAYERS * PRED_HIDDEN);
    const frameBuffer = new Float32Array(hidden);
    const ids: number[] = [];
    const times: Array<[number, number]> = [];

    let previousToken = blankId;
    let emitted = 0;
    let steps = 0;
    let t = 0;

    while (t < encodedFrames) {
      // [1, D, T] → eine Spalte [1, D, 1]
      for (let d = 0; d < hidden; d++) frameBuffer[d] = encodedData[d * encodedFrames + t];

      const out = await this.joiner.run({
        encoder_outputs: new ort.Tensor("float32", frameBuffer, [1, hidden, 1]),
        targets: new ort.Tensor("int32", Int32Array.from([previousToken]), [1, 1]),
        target_length: new ort.Tensor("int32", Int32Array.from([1]), [1]),
        input_states_1: new ort.Tensor("float32", state1, [PRED_LAYERS, 1, PRED_HIDDEN]),
        input_states_2: new ort.Tensor("float32", state2, [PRED_LAYERS, 1, PRED_HIDDEN]),
      });

      const values = (out["outputs"] as ort.Tensor).data as Float32Array;

      let tokenId = 0;
      let bestToken = -Infinity;
      for (let i = 0; i < vocabSize && i < values.length; i++) {
        if (values[i] > bestToken) {
          bestToken = values[i];
          tokenId = i;
        }
      }

      let step = 0;
      let bestDuration = -Infinity;
      for (let i = vocabSize; i < values.length; i++) {
        if (values[i] > bestDuration) {
          bestDuration = values[i];
          step = i - vocabSize;
        }
      }

      if (tokenId !== blankId) {
        // Der Decoder-Zustand wird nur bei einem echten Token übernommen
        // (Referenzverhalten); bei Blank bleibt der alte Zustand stehen.
        state1 = new Float32Array((out["output_states_1"] as ort.Tensor).data as Float32Array);
        state2 = new Float32Array((out["output_states_2"] as ort.Tensor).data as Float32Array);
        ids.push(tokenId);
        const durationFrames = step > 0 ? step : 1;
        times.push([t * TIME_STRIDE_S, Math.min(encodedFrames, t + Math.max(1, durationFrames)) * TIME_STRIDE_S]);
        previousToken = tokenId;
        emitted += 1;
      }

      if (step > 0) {
        t += step;
        emitted = 0;
      } else if (tokenId === blankId || emitted >= MAX_TOKENS_PER_STEP) {
        t += 1;
        emitted = 0;
      }

      steps += 1;
      if (onProgress && steps % 25 === 0) onProgress(Math.round(t * TIME_STRIDE_S * 1000));
    }

    const words = this.buildWords(ids, times, id2token);
    return { text: words.map((word) => word.text).join(" "), words };
  }

  private buildWords(
    ids: number[],
    times: Array<[number, number]>,
    id2token: string[]
  ): TranscriptWord[] {
    const words: TranscriptWord[] = [];
    let current = "";
    let startTime = 0;
    let endTime = 0;

    ids.forEach((id, index) => {
      const raw = id2token[id];
      if (!raw || raw === BLANK_TOKEN) return;

      const isWordStart = raw.startsWith(SPACE_MARK);
      const clean = isWordStart ? raw.slice(1) : raw;
      const [start, end] = times[index];

      if (isWordStart) {
        if (current) words.push({ text: current, start_time: startTime, end_time: endTime });
        current = clean;
        startTime = start;
        endTime = end;
      } else {
        current += clean;
        endTime = end;
      }
    });

    if (current) words.push({ text: current, start_time: startTime, end_time: endTime });
    return words;
  }
}
