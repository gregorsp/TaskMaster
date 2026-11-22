import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotifyContext";
import { DEFAULT_POMODORO_SETTINGS, type PomodoroSettings } from "../api/authApi";
import { playChime, unlockAudio } from "./chime";

export type PomodoroPhase = "work" | "shortBreak" | "longBreak";

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: "Fokus",
  shortBreak: "Kurze Pause",
  longBreak: "Lange Pause",
};

export interface PomodoroTask {
  id: string;
  title: string;
  /** Eigene Fokus-Länge dieser Aufgabe (Minuten); leer = persönlicher Standard. */
  workMinutes?: number | null;
}

/** Gespeicherter Zustand – nur auf diesem Gerät (localStorage), übersteht Neuladen. */
interface StoredState {
  phase: PomodoroPhase;
  /** Endzeitpunkt (ms) solange der Timer läuft, sonst null. */
  endsAt: number | null;
  /** Restzeit (ms) im pausierten Zustand. */
  remainingMs: number;
  /** Mitten in einer Phase angehalten. Sonst ruht der Timer und zeigt die volle Länge. */
  paused?: boolean;
  task: PomodoroTask | null;
  /** Abgeschlossene Fokus-Einheiten seit der letzten langen Pause. */
  streak: number;
  /** Abgeschlossene Fokus-Einheiten heute (für die Anzeige). */
  today: { date: string; count: number };
}

interface PomodoroApi {
  settings: PomodoroSettings;
  phase: PomodoroPhase;
  running: boolean;
  /** Gestartet oder pausiert, aber noch nicht beendet – dann zeigt die Kopfzeile den Timer. */
  active: boolean;
  remainingMs: number;
  totalMs: number;
  task: PomodoroTask | null;
  completedToday: number;
  start: (task?: PomodoroTask | null) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skip: () => void;
  setTask: (task: PomodoroTask | null) => void;
}

const STORAGE_KEY = "taskmaster.pomodoro";
const todayKey = () => new Date().toISOString().slice(0, 10);

const PomodoroContext = createContext<PomodoroApi | null>(null);

/** Länge einer Phase; die Fokus-Länge kann die gewählte Aufgabe vorgeben. */
function phaseMs(phase: PomodoroPhase, s: PomodoroSettings, task?: PomodoroTask | null) {
  const minutes = phase === "work" ? (task?.workMinutes ?? s.workMinutes)
    : phase === "shortBreak" ? s.shortBreakMinutes : s.longBreakMinutes;
  return minutes * 60_000;
}

function readStored(settings: PomodoroSettings): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredState;
  } catch { /* ignorieren */ }
  return { phase: "work", endsAt: null, remainingMs: phaseMs("work", settings), paused: false, task: null, streak: 0, today: { date: todayKey(), count: 0 } };
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Browser-Benachrichtigung, falls erlaubt (hilfreich, wenn der Tab im Hintergrund ist). */
function systemNotify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag: "pomodoro" });
  } catch { /* manche Mobilbrowser erlauben das nur über einen Service Worker */ }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const notify = useNotify();
  const settings = user?.pomodoroSettings ?? DEFAULT_POMODORO_SETTINGS;
  const [state, setState] = useState<StoredState>(() => readStored(settings));
  const [now, setNow] = useState(() => Date.now());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignorieren */ }
  }, [state]);

  const running = state.endsAt !== null;
  const totalMs = phaseMs(state.phase, settings, state.task);
  const remainingMs = running ? Math.max(0, state.endsAt! - now) : state.paused ? state.remainingMs : totalMs;
  const active = running || Boolean(state.paused);
  const completedToday = state.today.date === todayKey() ? state.today.count : 0;

  const stateRef = useRef(state);
  stateRef.current = state;
  /** Verhindert, dass dieselbe Phase zweimal beendet wird (z. B. zwei Ticks vor dem Neu-Rendern). */
  const finishedEndsAt = useRef<number | null>(null);

  /** Phase beendet: Ton, Hinweis, nächste Phase. Nach Fokus startet die Pause sofort, nach der Pause wartet der Timer. */
  const finishPhase = useCallback((withSignal: boolean) => {
    const prev = stateRef.current;
    if (prev.endsAt !== null) {
      if (finishedEndsAt.current === prev.endsAt) return;
      finishedEndsAt.current = prev.endsAt;
    }
    const s = settingsRef.current;
    let next: StoredState;
    let message: { snack: string; title: string; body: string };
    if (prev.phase === "work") {
      const streak = prev.streak + 1;
      const longBreak = streak >= s.longBreakEvery;
      const phase: PomodoroPhase = longBreak ? "longBreak" : "shortBreak";
      const count = (prev.today.date === todayKey() ? prev.today.count : 0) + 1;
      next = {
        ...prev, phase, streak: longBreak ? 0 : streak, paused: false,
        endsAt: Date.now() + phaseMs(phase, s), remainingMs: phaseMs(phase, s),
        today: { date: todayKey(), count },
      };
      const minutes = longBreak ? s.longBreakMinutes : s.shortBreakMinutes;
      const text = `${longBreak ? "Lange" : "Kurze"} Pause: ${minutes} ${minutes === 1 ? "Minute" : "Minuten"}.`;
      message = { snack: `Pomodoro geschafft! ${text}`, title: "Pomodoro geschafft", body: text };
    } else {
      next = { ...prev, phase: "work", endsAt: null, paused: false };
      message = {
        snack: "Pause vorbei – bereit für den nächsten Pomodoro?",
        title: "Pause vorbei",
        body: prev.task ? `Weiter mit: ${prev.task.title}` : "Bereit für den nächsten Pomodoro?",
      };
    }
    setState(next);
    if (withSignal) {
      notify(message.snack);
      systemNotify(message.title, message.body);
      if (s.sound) playChime();
      navigator.vibrate?.([300, 150, 300]);
    }
  }, [notify]);

  // Sekundentakt nur während der Timer läuft; das Ende wird über den Endzeitpunkt erkannt.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (state.endsAt !== null && t >= state.endsAt) finishPhase(true);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running, state.endsAt, finishPhase]);

  // Live im Browser-Tab: „12:34 · Aufgabe“.
  useEffect(() => {
    const base = document.title.replace(/^\d\d:\d\d · .*? – /, "");
    document.title = running ? `${formatClock(remainingMs)} · ${state.task?.title ?? PHASE_LABELS[state.phase]} – ${base}` : base;
  }, [running, remainingMs, state.task, state.phase]);

  const start = useCallback((task?: PomodoroTask | null) => {
    unlockAudio();
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    const s = settingsRef.current;
    setState((prev) => {
      const nextTask = task === undefined ? prev.task : task;
      return { ...prev, phase: "work", paused: false, endsAt: Date.now() + phaseMs("work", s, nextTask), task: nextTask };
    });
    setNow(Date.now());
  }, []);

  const pause = useCallback(() => {
    setState((prev) => (prev.endsAt === null ? prev : { ...prev, endsAt: null, paused: true, remainingMs: Math.max(0, prev.endsAt - Date.now()) }));
  }, []);

  const resume = useCallback(() => {
    unlockAudio();
    setState((prev) => (prev.endsAt !== null || !prev.paused ? prev : { ...prev, paused: false, endsAt: Date.now() + prev.remainingMs }));
    setNow(Date.now());
  }, []);

  const stop = useCallback(() => {
    setState((prev) => ({ ...prev, phase: "work", endsAt: null, paused: false, streak: 0 }));
  }, []);

  const skip = useCallback(() => finishPhase(false), [finishPhase]);
  const setTask = useCallback((task: PomodoroTask | null) => setState((prev) => ({ ...prev, task })), []);

  const value = useMemo<PomodoroApi>(() => ({
    settings, phase: state.phase, running, active, remainingMs, totalMs, task: state.task, completedToday,
    start, pause, resume, stop, skip, setTask,
  }), [settings, state.phase, running, active, remainingMs, totalMs, state.task, completedToday, start, pause, resume, stop, skip, setTask]);

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}

export function usePomodoro() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error("usePomodoro must be used within PomodoroProvider");
  return ctx;
}
