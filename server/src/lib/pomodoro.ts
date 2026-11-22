import { z } from "zod";

/** Persönliche Pomodoro-Einstellungen (gespeichert als JSON in `users.pomodoro_settings`). */
export const pomodoroSettingsSchema = z.object({
  workMinutes: z.number().int().min(1).max(180),
  shortBreakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(120),
  /** Nach so vielen Pomodoros folgt die lange Pause. */
  longBreakEvery: z.number().int().min(2).max(12),
  sound: z.boolean(),
});

export type PomodoroSettings = z.infer<typeof pomodoroSettingsSchema>;

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: true,
};

/** Gespeicherte Werte mit Standardwerten ergänzen; ungültiges JSON → Standard. */
export function parsePomodoroSettings(raw: string | null): PomodoroSettings {
  if (!raw) return DEFAULT_POMODORO_SETTINGS;
  try {
    const result = pomodoroSettingsSchema.safeParse({ ...DEFAULT_POMODORO_SETTINGS, ...JSON.parse(raw) });
    return result.success ? result.data : DEFAULT_POMODORO_SETTINGS;
  } catch {
    return DEFAULT_POMODORO_SETTINGS;
  }
}
