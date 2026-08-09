import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Capacity = Record<Weekday, number>;

export const capacitySchema = z.object({
  mon: z.number().int().min(0).max(99),
  tue: z.number().int().min(0).max(99),
  wed: z.number().int().min(0).max(99),
  thu: z.number().int().min(0).max(99),
  fri: z.number().int().min(0).max(99),
  sat: z.number().int().min(0).max(99),
  sun: z.number().int().min(0).max(99),
});

export function parseCapacity(raw: string | null): Capacity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Capacity;
    if (WEEKDAYS.some((d) => typeof parsed[d] !== "number")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeCapacity(capacity: Capacity | null): string | null {
  return capacity === null ? null : JSON.stringify(capacity);
}
