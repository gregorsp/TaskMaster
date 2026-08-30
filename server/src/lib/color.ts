function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0, 0];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

export function hexToHue(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return Math.round(h * 360);
}

export function averageHue(hues: number[]): number {
  if (hues.length === 0) return 0;
  let x = 0, y = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const avg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((Math.round(avg) % 360) + 360) % 360;
}

export function randomHueNear(base: number, jitter = 25): number {
  const offset = (Math.random() * 2 - 1) * jitter;
  return ((Math.round(base) + offset) % 360 + 360) % 360;
}

export function randomHue(): number {
  return Math.floor(Math.random() * 360);
}

export function hueForHexes(hexes: string[], jitter = 25): number {
  if (hexes.length === 0) return randomHue();
  const base = averageHue(hexes.map(hexToHue));
  return randomHueNear(base, jitter);
}
