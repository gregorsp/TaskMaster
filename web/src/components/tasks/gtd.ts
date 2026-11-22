import type { TaskDuration, TaskEnergy, TaskStatus } from "../../api/tasksApi";

/**
 * Einzige Stelle für die deutschen GTD-Bezeichnungen (Formular, Karte,
 * Filter, Tabs, Assistent, Review). Die Reihenfolge der Einträge ist die
 * Anzeigereihenfolge; bei Dauer und Energie ist sie zugleich aufsteigend.
 */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  next: "Nächster Schritt",
  waiting: "Warten auf",
  someday: "Irgendwann/Vielleicht",
};

export const DURATION_LABELS: Record<TaskDuration, string> = {
  under_2_min: "unter 2 Min",
  "15_min": "15 Min",
  "30_min": "30 Min",
  "60_min": "1 Std",
  long: "über 1 Std",
};

export const ENERGY_LABELS: Record<TaskEnergy, string> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};

/** Label-Map → geordnete `[wert, label]`-Paare für Auswahllisten. */
export function labelEntries<K extends string>(labels: Record<K, string>): [K, string][] {
  return Object.entries(labels) as [K, string][];
}
