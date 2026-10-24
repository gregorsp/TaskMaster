import { useEffect, useRef, useState } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { Mic, Stop } from "@mui/icons-material";
import { useNotify } from "../../context/NotifyContext";
import { isModelReady, transcribeBlob } from "../../asr/transcription";

interface Props {
  onText: (text: string) => void;
  disabled?: boolean;
  size?: "small" | "medium";
}

const MIME_CANDIDATES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

/**
 * Diktat in ein beliebiges Textfeld: die Aufnahme bleibt auf dem Gerät, wird
 * lokal transkribiert und der Text eingefügt. Es entsteht keine Aufnahme auf
 * dem Server.
 */
export function DictateButton({ onText, disabled, size = "small" }: Props) {
  const notify = useNotify();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 250);
    return () => window.clearInterval(interval);
  }, [recording]);

  const start = async () => {
    try {
      if (!(await isModelReady())) {
        notify("Sprachmodell fehlt – bitte in den Einstellungen einrichten", "warning");
        return;
      }

      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error("Dieser Browser kann kein Audio aufnehmen");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        setBusy(true);
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const result = await transcribeBlob(blob);
          const text = result.text.trim();
          if (text) onText(text);
          else notify("Nichts erkannt", "warning");
        } catch (error) {
          notify(String(error), "error");
        }
        setBusy(false);
      };

      recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      notify(`Aufnahme fehlgeschlagen: ${String(error)}`, "error");
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  return (
    <Tooltip title={recording ? `Aufnahme stoppen (${elapsed} s)` : busy ? "Transkribiert…" : "Diktieren"}>
      <span>
        <IconButton
          size={size}
          color={recording ? "error" : "default"}
          onClick={recording ? stop : start}
          disabled={disabled || busy}
          aria-label={recording ? "Aufnahme stoppen" : "Diktieren"}
        >
          {recording ? <Stop fontSize={size} /> : <Mic fontSize={size} />}
        </IconButton>
      </span>
    </Tooltip>
  );
}
