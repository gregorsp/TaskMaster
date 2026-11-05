/** Formatierung für die Audio-Seiten. MUI bringt nichts mit, date-fns wäre hier Overkill. */

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "–";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

/** Kurzform für Schätzungen: „12 min", „1 h 05 min". */
export function formatEta(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 60_000) return "unter 1 min";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return `${minutes} min`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "–";
  // Server liefert bereits einen Kalendertag (YYYY-MM-DD) in der App-Zeitzone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split("-");
    return `${day}.${month}.${year}`;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleDateString("de-DE");
}

/** Achsenbeschriftung: „05.11." */
export function formatShortDay(date: string): string {
  const [, month, day] = date.split("-");
  return `${day}.${month}.`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(digits).replace(".", ",")} %`;
}

/** Echtzeitfaktor: „4,2× Echtzeit". */
export function formatSpeedup(speedup: number | null | undefined): string {
  if (speedup == null || !Number.isFinite(speedup) || speedup <= 0) return "–";
  return `${speedup.toFixed(1).replace(".", ",")}× Echtzeit`;
}

export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "–";
  return formatSpeedup(rate);
}
