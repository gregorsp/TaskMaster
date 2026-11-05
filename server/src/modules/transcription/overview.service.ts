import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  journalAnswers,
  journalEntries,
  journalQuestions,
  meditationSessions,
  notes,
  recordings,
  transcriptionJobs,
  users,
} from "../../db/schema.js";
import { config } from "../../config.js";
import { zonedParts } from "./server/schedule.js";
import { listServerQueue } from "../recordings/recordings.service.js";
import { getRunStatus } from "./server/runner.js";
import { readNextRun } from "./server/runlog.js";
import { estimatedServerRate } from "../stats/audio.service.js";

/**
 * Daten für die Übersichtsseite: was läuft gerade, wie weit ist es, wie lange
 * dauert es noch, und was ist zuletzt durchgelaufen.
 *
 * Grundsatz: Fortschritt und Restzeit gibt es nur für Server-Jobs. Der
 * Browser-Läufer meldet keinen echten Fortschritt, sondern nur einen Heartbeat
 * mit 20 % – daraus einen Balken zu bauen wäre eine Lüge.
 */

export type OverviewScope = "mine" | "all";

export interface OverviewJob {
  id: string;
  recordingId: string;
  status: string;
  progressMs: number;
  durationMs: number;
  byteSize: number;
  mimeType: string;
  language: string;
  attempts: number;
  error: string | null;
  claimedBy: string | null;
  engine: string | null;
  processor: "server" | "device" | null;
  /** `null`, wenn der Fortschritt nicht messbar ist (Browser-Job). */
  percent: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  ownerType: string;
  ownerTitle: string | null;
  ownerDate: string | null;
  path: string | null;
  userId: string;
  displayName: string;
}

export interface OverviewRun {
  startedAt: string;
  triggeredBy: string;
  totalJobs: number;
  doneJobs: number;
  remainingJobs: number;
  totalMediaMs: number;
  /** 0 … 1 über die Audiolänge des Laufs. */
  percent: number;
  current: {
    recordingId: string;
    userId: string;
    durationMs: number;
    progressMs: number;
    percent: number;
  } | null;
  /** Audiolänge ÷ Wanduhr; 1 = Echtzeit. */
  rate: number | null;
  etaCurrentMs: number | null;
  etaQueueMs: number | null;
}

export interface OverviewEta {
  /** Echtzeitfaktor: Audiolänge pro Wanduhr-Millisekunde. */
  rate: number | null;
  /** Woher die Rate stammt – die UI erklärt damit, wie belastbar die Zahl ist. */
  rateSource: "measured" | "history" | "none";
  /** Restzeit bis die eigene Warteschlange leer ist (`scope: "all"`: bis alle fertig sind). */
  etaQueueMs: number | null;
  etaCurrentMs: number | null;
  /** Audiolänge, die vor dem eigenen ältesten offenen Job liegt. */
  mediaAheadMs: number;
  openMediaMs: number;
}

export interface OverviewResult {
  scope: OverviewScope;
  server: { enabled: boolean; running: boolean; nextRunAt: string | null };
  deviceJobs: number;
  queue: { pending: number; failed: number; running: number };
  run: OverviewRun | null;
  eta: OverviewEta;
  jobs: { active: OverviewJob[]; recent: OverviewJob[]; failed: OverviewJob[] };
  recentTotal: number;
  limit: number;
  offset: number;
}

interface OwnerInfo {
  title: string | null;
  date: string | null;
  path: string | null;
}

function isoDate(instant: Date): string {
  const parts = zonedParts(instant, config.transcriptionTz);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

const EMPTY_OWNER: OwnerInfo = { title: null, date: null, path: null };

/**
 * Titel und Einstiegspunkt der Quelle. Aufnahmen hängen an Notiz, Journal oder
 * Meditation – ohne diesen Schritt wäre die Liste eine Reihe von UUIDs.
 */
function resolveOwners(keys: Array<{ ownerType: string; ownerId: string }>): Map<string, OwnerInfo> {
  const db = getDb();
  const result = new Map<string, OwnerInfo>();
  const idsFor = (type: string) => [...new Set(keys.filter((key) => key.ownerType === type).map((key) => key.ownerId))];

  const noteIds = idsFor("note");
  if (noteIds.length > 0) {
    const rows = db.select({ id: notes.id, title: notes.title }).from(notes).where(inArray(notes.id, noteIds)).all();
    for (const row of rows) {
      result.set(`note:${row.id}`, { title: row.title, date: null, path: `/notes?note=${row.id}` });
    }
  }

  const entryIds = idsFor("journal_entry");
  if (entryIds.length > 0) {
    const rows = db
      .select({ id: journalEntries.id, entryDate: journalEntries.entryDate })
      .from(journalEntries)
      .where(inArray(journalEntries.id, entryIds))
      .all();
    for (const row of rows) {
      result.set(`journal_entry:${row.id}`, {
        title: null,
        date: row.entryDate,
        path: `/daily?date=${row.entryDate}`,
      });
    }
  }

  const answerIds = idsFor("journal_answer");
  if (answerIds.length > 0) {
    const rows = db
      .select({
        id: journalAnswers.id,
        answerDate: journalAnswers.answerDate,
        question: journalQuestions.text,
      })
      .from(journalAnswers)
      .innerJoin(journalQuestions, eq(journalQuestions.id, journalAnswers.questionId))
      .where(inArray(journalAnswers.id, answerIds))
      .all();
    for (const row of rows) {
      result.set(`journal_answer:${row.id}`, {
        title: row.question,
        date: row.answerDate,
        path: `/daily?date=${row.answerDate}`,
      });
    }
  }

  const meditationIds = idsFor("meditation_session");
  if (meditationIds.length > 0) {
    const rows = db
      .select({ id: meditationSessions.id, startedAt: meditationSessions.startedAt })
      .from(meditationSessions)
      .where(inArray(meditationSessions.id, meditationIds))
      .all();
    for (const row of rows) {
      result.set(`meditation_session:${row.id}`, {
        title: null,
        date: isoDate(row.startedAt),
        path: `/meditation?session=${row.id}`,
      });
    }
  }

  return result;
}

type JobRowWithRecording = {
  job: typeof transcriptionJobs.$inferSelect;
  recording: typeof recordings.$inferSelect;
  displayName: string;
};

function toOverviewJobs(rows: JobRowWithRecording[]): OverviewJob[] {
  const owners = resolveOwners(rows.map((row) => ({ ownerType: row.recording.ownerType, ownerId: row.recording.ownerId })));

  return rows.map(({ job, recording, displayName }) => {
    const owner = owners.get(`${recording.ownerType}:${recording.ownerId}`) ?? EMPTY_OWNER;
    const processor = job.engine === "server" ? "server" : job.engine === "device" ? "device" : null;
    const percent =
      job.engine === "server" && recording.durationMs > 0
        ? Math.max(0, Math.min(1, job.progressMs / recording.durationMs))
        : null;

    return {
      id: job.id,
      recordingId: job.recordingId,
      status: job.status,
      progressMs: job.progressMs,
      durationMs: recording.durationMs,
      byteSize: recording.byteSize,
      mimeType: recording.mimeType,
      language: recording.language,
      attempts: job.attempts,
      error: job.error,
      claimedBy: job.claimedBy,
      engine: job.engine,
      processor,
      percent,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      updatedAt: job.updatedAt.toISOString(),
      ownerType: recording.ownerType,
      ownerTitle: owner.title,
      ownerDate: owner.date,
      path: owner.path,
      userId: job.userId,
      displayName,
    };
  });
}

/**
 * Sortierschlüssel für „fertig": `finished_at` ist seit Migration 0018 gesetzt.
 * Ältere Zeilen haben den Wert nicht – bei ihnen ist `updated_at` aber exakt der
 * Abschlusszeitpunkt (`writeSegments` schreibt beide in einem Zug).
 */
function finishedAtExpr() {
  return sql`coalesce(${transcriptionJobs.finishedAt}, ${transcriptionJobs.updatedAt})`;
}

export function getOverview(options: {
  scope: OverviewScope;
  userId: string;
  doneSince: Date;
  limit: number;
  offset: number;
  now?: Date;
}): OverviewResult {
  const db = getDb();
  const now = options.now ?? new Date();
  const scopeWhere = options.scope === "all" ? undefined : eq(transcriptionJobs.userId, options.userId);

  const base = () =>
    db
      .select({ job: transcriptionJobs, recording: recordings, displayName: users.displayName })
      .from(transcriptionJobs)
      .innerJoin(recordings, eq(recordings.id, transcriptionJobs.recordingId))
      .innerJoin(users, eq(users.id, transcriptionJobs.userId));

  const activeRows = base()
    .where(and(scopeWhere, inArray(transcriptionJobs.status, ["claimed", "running"])))
    .orderBy(desc(transcriptionJobs.updatedAt))
    .all();

  const recentWhere = and(
    scopeWhere,
    eq(transcriptionJobs.status, "done"),
    sql`${finishedAtExpr()} >= ${options.doneSince.getTime()}`
  );

  const recentRows = base()
    .where(recentWhere)
    .orderBy(desc(finishedAtExpr()))
    .limit(options.limit)
    .offset(options.offset)
    .all();

  const recentTotal =
    db
      .select({ count: sql<number>`count(*)` })
      .from(transcriptionJobs)
      .where(recentWhere)
      .get()?.count ?? 0;

  const failedRows = base()
    .where(and(scopeWhere, eq(transcriptionJobs.status, "failed")))
    .orderBy(desc(transcriptionJobs.updatedAt))
    .limit(100)
    .all();

  const countRows = db
    .select({ status: transcriptionJobs.status, count: sql<number>`count(*)` })
    .from(transcriptionJobs)
    .where(scopeWhere)
    .groupBy(transcriptionJobs.status)
    .all();

  const queue = { pending: 0, failed: 0, running: 0 };
  for (const row of countRows) {
    if (row.status === "pending") queue.pending += row.count;
    else if (row.status === "failed") queue.failed += row.count;
    else if (row.status === "claimed" || row.status === "running") queue.running += row.count;
  }

  const deviceJobs = activeRows.filter((row) => row.job.engine !== "server").length;

  // ---------------------------------------------------------------------------
  // Restzeit
  // ---------------------------------------------------------------------------
  const runStatus = getRunStatus();
  const current = runStatus?.current ?? null;
  const currentRemainingMs = current ? Math.max(0, current.durationMs - current.progressMs) : 0;

  // listServerQueue liefert die verbleibende Schlange; der laufende Job fällt
  // heraus, weil sein Heartbeat frisch ist – seine Restmenge zählen wir separat.
  const pendingQueue = listServerQueue(now).map((entry) => ({
    userId: entry.job.userId,
    durationMs: entry.recording.durationMs || 0,
  }));
  const queueRemainingMs = pendingQueue.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalRemainingMs = queueRemainingMs + currentRemainingMs;

  let mediaAheadMs = 0;
  let openMediaMs = 0;
  if (options.scope === "mine") {
    const myIndex = pendingQueue.findIndex((entry) => entry.userId === options.userId);
    if (myIndex > 0) {
      mediaAheadMs = pendingQueue.slice(0, myIndex).reduce((sum, entry) => sum + entry.durationMs, 0);
    }
    openMediaMs = pendingQueue
      .filter((entry) => entry.userId === options.userId)
      .reduce((sum, entry) => sum + entry.durationMs, 0);
    // Läuft gerade ein fremder Job, liegt er vor allem, was noch in der Schlange steht.
    if (current && current.userId !== options.userId) mediaAheadMs += currentRemainingMs;
  } else {
    openMediaMs = queueRemainingMs;
  }

  const myRemainingMs =
    options.scope === "mine" ? mediaAheadMs + openMediaMs + (current?.userId === options.userId ? currentRemainingMs : 0) : totalRemainingMs;

  const measuredRate = runStatus?.rate ?? null;
  const historyRate = measuredRate === null ? estimatedServerRate() : null;
  const rate = measuredRate ?? historyRate;
  const rateSource: OverviewEta["rateSource"] = measuredRate !== null ? "measured" : historyRate !== null ? "history" : "none";

  const eta: OverviewEta = {
    rate,
    rateSource,
    etaQueueMs: rate && rate > 0 && myRemainingMs > 0 ? Math.round(myRemainingMs / rate) : null,
    etaCurrentMs: rate && rate > 0 && current ? Math.round(currentRemainingMs / rate) : null,
    mediaAheadMs,
    openMediaMs,
  };

  // ---------------------------------------------------------------------------
  // Fortschritt des Laufs
  // ---------------------------------------------------------------------------
  let run: OverviewRun | null = null;
  if (runStatus) {
    // Nenner bleibt der Snapshot vom Laufbeginn; der Zähler wächst um fertige
    // Aufnahmen plus den bereits abgearbeiteten Teil der laufenden. Damit ist
    // der Balken monoton, auch wenn während des Laufs neue Aufträge eintreffen.
    const totalMediaMs = runStatus.totalMediaMs;
    const inFlightMs = current ? Math.min(current.durationMs, current.progressMs) : 0;
    const doneMediaMs = Math.min(totalMediaMs, runStatus.doneMediaMs + inFlightMs);
    const remainingJobs = pendingQueue.length;
    run = {
      startedAt: runStatus.startedAt,
      triggeredBy: runStatus.triggeredBy,
      totalJobs: runStatus.totalJobs,
      doneJobs: runStatus.doneJobs,
      remainingJobs,
      totalMediaMs,
      percent: totalMediaMs > 0 ? Math.min(1, Math.max(0, doneMediaMs / totalMediaMs)) : 0,
      current: current
        ? {
            recordingId: current.recordingId,
            userId: current.userId,
            durationMs: current.durationMs,
            progressMs: current.progressMs,
            percent: current.durationMs > 0 ? Math.min(1, current.progressMs / current.durationMs) : 0,
          }
        : null,
      rate: measuredRate,
      etaCurrentMs: eta.etaCurrentMs,
      etaQueueMs: eta.etaQueueMs,
    };
  }

  return {
    scope: options.scope,
    server: { enabled: config.transcribeServer, running: runStatus !== null, nextRunAt: readNextRun() },
    deviceJobs,
    queue,
    run,
    eta,
    jobs: {
      active: toOverviewJobs(activeRows),
      recent: toOverviewJobs(recentRows),
      failed: toOverviewJobs(failedRows),
    },
    recentTotal,
    limit: options.limit,
    offset: options.offset,
  };
}
