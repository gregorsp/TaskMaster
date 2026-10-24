import { useEffect, useRef } from "react";

/**
 * Aktualisiert eine Ansicht, sobald der Hintergrund-Läufer eine Transkription
 * abgeschlossen hat — ohne dass man die Seite neu laden muss.
 */
export function useTranscriptionRefresh(callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const handler = () => callbackRef.current();
    window.addEventListener("taskmaster:transcription-done", handler);
    return () => window.removeEventListener("taskmaster:transcription-done", handler);
  }, []);
}
