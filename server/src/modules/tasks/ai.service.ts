import { config } from "../../config.js";
import { DEFAULT_CONTEXTS } from "../contexts/contexts.service.js";
import {
  TASK_DURATIONS, TASK_ENERGIES, TASK_STATUSES,
  type TaskDuration, type TaskEnergy, type TaskStatus,
} from "./tasks.schema.js";

/**
 * KI-Helfer. Der Schlüssel kommt aus der verschlüsselten Nutzer-Einstellung
 * (oder ersatzweise aus der Server-Konfiguration) und wird **nicht** mehr vom
 * Client mitgeschickt.
 */

export interface AiTaskSuggestion {
  description: string;
  context: string | null;
  duration: TaskDuration | null;
  energy: TaskEnergy | null;
  status: TaskStatus | null;
}

type Provider = { kind: "gemini"; key: string } | { kind: "deepseek"; key: string };

function resolveProvider(apiKey?: string): Provider | null {
  const key = apiKey || "";
  if (key.startsWith("AIza") || key.startsWith("AQ.")) return { kind: "gemini", key };
  if (key) return { kind: "deepseek", key };
  if (config.geminiApiKey) return { kind: "gemini", key: config.geminiApiKey };
  if (config.deepseekApiKey) return { kind: "deepseek", key: config.deepseekApiKey };
  return null;
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) throw new Error(`Gemini: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: leere Antwort");
  return text;
}

async function callDeepSeek(prompt: string, key: string, temperature: number): Promise<string> {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek: leere Antwort");
  return text;
}

async function complete(prompt: string, apiKey: string | undefined, temperature: number): Promise<string> {
  const provider = resolveProvider(apiKey);
  if (!provider) {
    throw new Error("Kein KI-Schlüssel hinterlegt. Bitte in den Einstellungen speichern.");
  }
  return provider.kind === "gemini"
    ? callGemini(prompt, provider.key)
    : callDeepSeek(prompt, provider.key, temperature);
}

const CONTEXT_NAMES = DEFAULT_CONTEXTS.map((c) => c.name);
const quoted = (values: readonly string[]) => values.map((v) => `"${v}"`).join(", ");

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("KI-Antwort enthielt kein JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateGtdDescription(
  title: string,
  currentDescription: string | undefined,
  apiKey?: string
): Promise<AiTaskSuggestion> {
  const prompt = [
    "Du bist ein GTD-Experte nach David Allen.",
    `Aufgabentitel: "${title}"`,
    currentDescription ? `Bisherige Notizen: "${currentDescription}"` : "",
    "",
    "Ordne die Aufgabe ein und schreibe eine kurze, strukturierte Beschreibung auf Deutsch.",
    "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form:",
    '{"description": "...", "context": "Telefon", "duration": "under_2_min", "energy": "low", "status": "next"}',
    "Erlaubte Werte:",
    `- context: ${quoted(CONTEXT_NAMES)} oder null`,
    `- duration: ${quoted(TASK_DURATIONS)} oder null ("long" = über eine Stunde)`,
    `- energy: ${quoted(TASK_ENERGIES)} oder null`,
    '- status: "next" (konkreter nächster Schritt), "waiting" (jemand anderes muss liefern), "someday" (vage Idee) oder null',
    "",
    "Regeln:",
    '- "description": Zielbild, nächster physischer Schritt und 2-4 Checklisten-Stichpunkte als kurzer Text, ohne Einleitung.',
    '- "duration": geschätzte Dauer, nur setzen, wenn sie sich halbwegs sicher abschätzen lässt.',
    '- "energy": nur setzen, wenn der Energiebedarf eindeutig ist.',
    '- "status": nur setzen, wenn einer der Fälle klar zutrifft.',
    "Keine Erklärungen außerhalb des JSON.",
  ].filter(Boolean).join("\n");

  const text = await complete(prompt, apiKey, 0.3);
  const parsed = extractJson(text) as Record<string, unknown>;
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  if (!description) throw new Error("KI-Antwort enthielt keine Beschreibung.");

  const context = typeof parsed.context === "string"
    ? (CONTEXT_NAMES.find((name) => name.toLowerCase() === String(parsed.context).trim().toLowerCase()) ?? null)
    : null;

  return {
    description,
    context,
    duration: pick(parsed.duration, TASK_DURATIONS),
    energy: pick(parsed.energy, TASK_ENERGIES),
    status: pick(parsed.status, TASK_STATUSES),
  };
}

export async function generateMindmapIdeas(topic: string, apiKey?: string): Promise<string[]> {
  const prompt = [
    "Du bist ein GTD-Produktivitätsexperte nach David Allen.",
    `Projektthema: "${topic}"`,
    "",
    "Nenne genau 5 konkrete, kurze nächste physische Schritte (jeweils maximal 5 Wörter, ohne Nummerierung, ohne Aufzählungszeichen), um dieses Projekt umzusetzen.",
    "Antworte nur mit den 5 Zeilen, eine Aufgabe pro Zeile.",
  ].join("\n");

  const text = await complete(prompt, apiKey, 0.4);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\d.\-*•\s]+/, "").trim())
    .filter((line) => line.length > 1)
    .slice(0, 5);
}
