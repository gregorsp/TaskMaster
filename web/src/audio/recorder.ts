import { completeRecording, createRecordingForOwner, uploadChunk } from "../api/notesApi";

export type RecordingOwnerType = "note" | "journal_entry" | "journal_answer" | "meditation_session";

const MIME_CANDIDATES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let activeRecordings = 0;

/** Solange aufgenommen wird, pausiert die automatische Transkription. */
export function isRecordingActive(): boolean {
  return activeRecordings > 0;
}

function pickMimeType(): string {
  for (const candidate of MIME_CANDIDATES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  throw new Error("Dieser Browser kann kein Audio aufnehmen");
}

export interface StartOptions {
  ownerType: RecordingOwnerType;
  ownerId: string;
}

export interface StopResult {
  recordingId: string;
  durationMs: number;
  truncated: boolean;
}

/**
 * Aufnahme in 10-s-Chunks, die sofort hochgeladen werden.
 *
 * Firefox beendet jede Aufnahme, sobald der Tab nicht mehr sichtbar ist —
 * das ist kein Fehlerfall, sondern der Normalfall auf dieser Plattform: die
 * bereits übertragenen Chunks bleiben erhalten, die Aufnahme gilt danach als
 * unvollständig.
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private recordingId: string | null = null;
  private startedAt = 0;
  private seq = 0;
  private pending: Blob[] = [];
  private draining: Promise<void> | null = null;
  private stopResolve: ((result: StopResult) => void) | null = null;
  private stoppedByBrowser = false;
  private finishing = false;
  private uploadedBytes = 0;
  private countedActive = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private visibilityHandler: (() => void) | null = null;

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  get activeRecordingId(): string | null {
    return this.recordingId;
  }

  async start(options: StartOptions): Promise<void> {
    const mimeType = pickMimeType();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const created = await createRecordingForOwner({
      ownerType: options.ownerType,
      ownerId: options.ownerId,
      mimeType,
      startedAt: new Date().toISOString(),
    });

    this.recordingId = created.id;
    this.seq = 0;
    this.pending = [];
    this.draining = null;
    this.uploadedBytes = 0;
    this.finishing = false;
    this.stoppedByBrowser = false;
    this.startedAt = Date.now();

    const recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 128_000 });
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.enqueue(event.data);
    };

    recorder.onstop = () => {
      const durationMs = this.elapsedMs;
      void this.finish(durationMs);
    };

    this.visibilityHandler = () => {
      if (document.visibilityState === "visible") {
        void this.requestWakeLock();
      } else if (this.mediaRecorder?.state === "recording") {
        // In Firefox hat der Browser die Aufnahme bereits beendet; der
        // onstop-Handler markiert das Ergebnis als unvollständig.
        this.stoppedByBrowser = true;
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);

    await this.requestWakeLock();
    recorder.start(10_000);
    activeRecordings += 1;
    this.countedActive = true;
  }

  async stop(): Promise<StopResult> {
    const recorder = this.mediaRecorder;
    if (!recorder) throw new Error("Es läuft keine Aufnahme");

    const promise = new Promise<StopResult>((resolve) => {
      this.stopResolve = resolve;
    });

    if (recorder.state === "recording") {
      recorder.stop();
    } else {
      void this.finish(this.elapsedMs);
    }

    return promise;
  }

  private enqueue(blob: Blob): void {
    this.pending.push(blob);
    void this.drain().catch(() => {});
  }

  /**
   * Startet den Upload, falls keiner läuft, und wartet in jedem Fall auf den
   * laufenden. Der frühere Kurzschluss (`if (this.draining) return;`) hat beim
   * Stoppen den letzten Chunk verloren, weil `complete` vor ihm ankam.
   */
  private async drain(): Promise<void> {
    if (!this.recordingId) return;

    let active = this.draining;
    if (!active) {
      active = this.uploadLoop();
      this.draining = active;
      void active
        .catch(() => {})
        .finally(() => {
          if (this.draining === active) this.draining = null;
        });
    }

    await active;
  }

  private async uploadLoop(): Promise<void> {
    while (this.pending.length > 0) {
      const chunk = this.pending[0];
      let uploaded = false;

      for (let attempt = 0; attempt < 6 && !uploaded; attempt++) {
        try {
          await uploadChunk(this.recordingId as string, this.seq, chunk);
          uploaded = true;
        } catch (error) {
          const response = (
            error as { response?: { status?: number; data?: { error?: { code?: string } } } }
          ).response;

          // Ein erneut gesendeter, bereits gespeicherter Chunk ist kein Fehler.
          if (response?.status === 200) {
            uploaded = true;
            break;
          }
          if (response?.data?.error?.code === "RECORDING_COMPLETE") {
            // Die Aufnahme wurde abgeschlossen, bevor dieser Chunk ankam — das
            // ist Datenverlust und darf nicht als Erfolg durchgehen.
            throw new Error("Aufnahme wurde zu früh abgeschlossen – der letzte Abschnitt fehlt");
          }
          await sleep(400 * (attempt + 1));
        }
      }

      if (!uploaded) throw new Error("Chunk konnte nicht hochgeladen werden");
      this.pending.shift();
      this.uploadedBytes += chunk.size;
      this.seq += 1;
    }
  }

  /** Wartet, bis alle Chunks übertragen sind — auch solche, die während des Wartens eintreffen. */
  private async flush(): Promise<void> {
    for (let guard = 0; guard < 100; guard++) {
      if (this.draining) {
        await this.draining;
        continue;
      }
      if (this.pending.length === 0) return;
      await this.drain();
    }
    throw new Error("Aufnahme konnte nicht vollständig hochgeladen werden");
  }

  private async finish(durationMs: number): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;

    const recordingId = this.recordingId;
    const resolve = this.stopResolve;
    this.stopResolve = null;

    let uploadComplete = false;
    try {
      await this.flush();
      uploadComplete = true;
    } catch {
      uploadComplete = false;
    }

    if (recordingId && uploadComplete) {
      try {
        await completeRecording(recordingId, durationMs, this.uploadedBytes);
      } catch {
        uploadComplete = false;
      }
    }

    this.cleanup();
    this.finishing = false;

    if (recordingId && resolve) {
      resolve({ recordingId, durationMs, truncated: this.stoppedByBrowser || !uploadComplete });
    }
  }

  private cleanup(): void {
    if (this.countedActive) {
      this.countedActive = false;
      activeRecordings = Math.max(0, activeRecordings - 1);
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const wakeLock = (
        navigator as Navigator & {
          wakeLock?: { request: (type: string) => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock;
      if (!wakeLock) return;
      this.wakeLock = await wakeLock.request("screen");
    } catch {
      // Wake Lock ist optional; die Aufnahme läuft auch ohne.
    }
  }
}
