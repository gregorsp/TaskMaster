import type { TaskStatus } from "../../api/tasksApi";

/**
 * Einzige Stelle für die deutschen GTD-Bezeichnungen (Formular, Karte,
 * Filter, Tabs, Assistent, Review). Die Reihenfolge ist die Anzeigereihenfolge.
 */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  next: "Nächster Schritt",
  waiting: "Warten auf",
  someday: "Irgendwann/Vielleicht",
};

/** Label-Map → geordnete `[wert, label]`-Paare für Auswahllisten. */
export function labelEntries<K extends string>(labels: Record<K, string>): [K, string][] {
  return Object.entries(labels) as [K, string][];
}
