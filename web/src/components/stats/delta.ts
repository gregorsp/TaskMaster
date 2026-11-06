export interface DeltaInfo {
  text: string;
  /** `true` = besser, `false` = schlechter, `null` = neutral. */
  good: boolean | null;
}

/** Vergleich absoluter Zähler: prozentuale Veränderung. */
export function countDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): DeltaInfo | null {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    if (current === 0) return { text: "±0", good: null };
    return { text: "neu", good: null };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { text: "±0 %", good: null };
  return { text: `${percent > 0 ? "▲" : "▼"} ${Math.abs(percent)} %`, good: percent > 0 };
}

/** Vergleich von Quoten (0…1): Differenz in Prozentpunkten. */
export function rateDelta(
  current: number | null | undefined,
  previous: number | null | undefined
): DeltaInfo | null {
  if (current == null || previous == null) return null;
  const points = Math.round((current - previous) * 1000) / 10;
  if (points === 0) return { text: "±0 Pp", good: null };
  return {
    text: `${points > 0 ? "▲" : "▼"} ${Math.abs(points).toFixed(1).replace(".", ",")} Pp`,
    good: points > 0,
  };
}

/** Bei Kennzahlen, bei denen weniger besser ist (überfällig, Fehlerquote). */
export function invertDelta(delta: DeltaInfo | null): DeltaInfo | null {
  if (!delta || delta.good === null) return delta;
  return { ...delta, good: !delta.good };
}

export function formatDecimal(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "–";
  return value.toFixed(digits).replace(".", ",");
}
