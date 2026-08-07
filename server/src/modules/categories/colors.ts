const PREDEFINED_PALETTE: string[] = [
  "#0c66e4", "#1982c4", "#7b5ea7", "#c43e2c",
  "#e06c00", "#d4a017", "#2d8c4a", "#0b8043",
  "#5c6bc0", "#ec407a", "#8d6e63", "#78909c",
];

function hslDistance(c1: string, c2: string): number {
  const h1 = hexToHsl(c1);
  const h2 = hexToHsl(c2);
  const dh = Math.min(Math.abs(h1[0] - h2[0]), 360 - Math.abs(h1[0] - h2[0])) / 180;
  const ds = Math.abs(h1[1] - h2[1]) / 100;
  const dl = Math.abs(h1[2] - h2[2]) / 100;
  return Math.sqrt(dh * dh + ds * ds + dl * dl);
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function autoColor(existingColors: string[]): string {
  if (existingColors.length === 0) return PREDEFINED_PALETTE[0];

  let bestColor = PREDEFINED_PALETTE[0];
  let bestMinDistance = -Infinity;

  for (const candidate of PREDEFINED_PALETTE) {
    if (existingColors.includes(candidate)) continue;
    const distances = existingColors.map((c) => hslDistance(candidate, c));
    const minDist = Math.min(...distances);
    if (minDist > bestMinDistance) {
      bestMinDistance = minDist;
      bestColor = candidate;
    }
  }

  if (bestMinDistance < 0) {
    const seed = existingColors.length;
    const h = (seed * 137.5) % 360;
    return `hsl(${Math.round(h)}, 60%, 50%)`;
  }

  return bestColor;
}
