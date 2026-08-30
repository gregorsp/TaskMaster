const FALLBACK_HUE = 210;

export function hexToHue(hex: string): number {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let hue = 0;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return Math.round(hue * 360);
}

export function averageHue(hues: number[]): number {
  if (hues.length === 0) return FALLBACK_HUE;
  let x = 0, y = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const avg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((Math.round(avg) % 360) + 360) % 360;
}

export function normalizeHue(hue: number): number {
  return ((Math.round(hue) % 360) + 360) % 360;
}

export function effectiveHue(colorHue: number | null | undefined, categoryColors: string[]): number {
  if (colorHue != null) return normalizeHue(colorHue);
  if (categoryColors.length > 0) return averageHue(categoryColors.map(hexToHue));
  return FALLBACK_HUE;
}

export function hueToColor(hue: number, mode: "light" | "dark"): string {
  const s = mode === "dark" ? 60 : 55;
  const l = mode === "dark" ? 68 : 42;
  return `hsl(${normalizeHue(hue)}, ${s}%, ${l}%)`;
}

export function taskColor(colorHue: number | null | undefined, categoryColors: string[], mode: "light" | "dark"): string {
  return hueToColor(effectiveHue(colorHue, categoryColors), mode);
}

export interface ColorSource {
  colorHue?: number | null;
  categories?: { color: string }[];
}

export function colorFrom(source: ColorSource, mode: "light" | "dark"): string {
  return taskColor(source.colorHue ?? null, (source.categories ?? []).map((c) => c.color), mode);
}

export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
  if (m) {
    return `hsla(${m[1]}, ${m[2]}%, ${m[3]}%, ${alpha})`;
  }
  let hex = color.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${hex}${a}`;
}
