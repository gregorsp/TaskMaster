/**
 * Segmentierung – Muss identisch zum Client sein, sonst sehen Transkripte je
 * nach Gerät anders aus.
 *
 * Vorlage: `web/src/asr/transcription.ts` (`splitSentences`, `buildSegments`).
 * Die beiden Pakete teilen keinen Code (getrennte `package.json`, kein
 * Workspace), deshalb ist die Logik hier bewusst abgeschrieben und durch
 * denselben Testdatensatz abgesichert (`test/transcription-server.test.ts`).
 */

export interface TranscriptWord {
  text: string;
  start_time: number;
  end_time: number;
}

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number];
}

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

const MAX_WORDS_PER_SENTENCE = 24;

export function splitSentences(words: TranscriptWord[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.map((word) => word.text).join(" "),
      timestamp: [current[0].start_time, current[current.length - 1].end_time],
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    if (/[.!?…]$/.test(word.text) || current.length >= MAX_WORDS_PER_SENTENCE) flush();
  }
  flush();
  return chunks;
}

export function buildSegments(
  words: TranscriptWord[],
  fallbackChunks: TranscriptChunk[],
  text: string,
  durationMs: number
): Segment[] {
  const sentences = splitSentences(words);
  const chunks = sentences.length > 0 ? sentences : fallbackChunks;

  if (chunks.length > 0) {
    return chunks
      .map((chunk) => ({
        startMs: Math.max(0, Math.round(chunk.timestamp[0] * 1000)),
        endMs: Math.max(0, Math.round(chunk.timestamp[1] * 1000)),
        text: chunk.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0);
  }
  if (text.trim().length > 0) {
    return [{ startMs: 0, endMs: durationMs, text: text.trim() }];
  }
  return [];
}
