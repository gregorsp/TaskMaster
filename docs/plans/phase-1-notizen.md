# Phase 1 — Notizen mit Audio und lokaler Transkription

Umsetzungsplan für den ersten Teil der Erweiterung (Notizen → Tagebuch → Meditation).
Alle Begriffe nach [GLOSSARY.md](../../GLOSSARY.md).

## Umfang

Eine Seite **Notizen**: Text-Notiz oder Audio-Notiz, Chunk-Upload während der Aufnahme,
Transkription auf dem Gerät, Player mit Segment-Sync, Suche, strikt privat.

Nicht in Phase 1: Tagebuch, Meditation, Aufgaben-Zuordnung, Diktat in Aufgaben.
Das Datenmodell nimmt sie aber schon auf (`recordings.ownerType`).

## Entschiedene Eckpunkte

- Audio wird **nie verändert** (kein ffmpeg, kein Remux) → ADR 0002.
- Transkription läuft **nur auf Geräten**; der Pi speichert und verwaltet Jobs → ADR 0001.
- Aufnahme nur bei sichtbarem Tab und wachem Bildschirm; Unterbrechung wird als
  „unvollständig" markiert, bereits hochgeladene Chunks bleiben.
- 10-s-Chunks, 128 kbit/s (Browser-Standard), Limit 128 MB pro Aufnahme.
- Notiz-Arten sind fest: `text` oder `audio`. Audio-Notizen haben keinen zweiten Text;
  korrigiert wird im Segment.
- Aufnahmen sind 1:n zur Notiz (Offsets = kumulierte Dauern), Antwort/Eintrag später 1:1.
- COOP/COEP global an, damit WASM-Threads laufen.
- Deutsch als Default-Sprache, in den Einstellungen änderbar.

## Datenmodell

Migration `0014_*`, `SCHEMA_VERSION` 11 → 12.

```ts
// users: + transcriptionLanguage text notNull default 'de'

notes: id text pk, user_id → users, kind ('text'|'audio'), title, body (null bei audio),
       created_at, updated_at
  index (user_id, created_at desc)

recordings: id text pk, user_id → users, owner_type, owner_id, ordinal, filename,
            mime_type, byte_size, duration_ms, language, status ('uploading'|'ready'|'failed'),
            started_at, created_at
  index (owner_type, owner_id)

transcription_jobs: id text pk, recording_id → recordings (unique), user_id, status
            ('pending'|'claimed'|'running'|'done'|'failed'), progress_ms, claimed_by,
            lease_until, attempts, error, created_at, updated_at
  index (user_id, status)

transcript_segments: id text pk, recording_id → recordings, idx, start_ms, end_ms, text
  unique (recording_id, idx)
```

Zeitstempel durchgehend `integer({ mode: "timestamp_ms" })`, IDs `text` (UUID), wie im Rest des Schemas.
`owner_type` ist bereits auf `journal_entry` / `answer` / `meditation_session` vorbereitet, wird in
Phase 1 aber nur mit `note` geschrieben.

## Server

Neue Module (Muster wie `modules/tasks/`): `addHook("preHandler", authGuard)`, Zod-Validierung,
Fehler über den globalen Handler.

| Modul | Präfix | Inhalt |
|---|---|---|
| `modules/notes/` | `/api/notes` | CRUD, Suche, Kaskaden-Löschung |
| `modules/recordings/` | `/api/recordings` | Chunk-Append, Abschluss, Range-Audio, Segmente |
| `modules/transcription/` | `/api/transcription` | Job-Claim, Heartbeat, Abschluss |

Routen:

- `GET /api/notes?cursor=&limit=&q=&filter=open` — Liste, Suche über `title` und Segmente.
- `POST /api/notes` — `{kind, title?, body?}`; bei `audio` legt der Client die Notiz beim Aufnahmestart an.
- `GET /api/notes/:id` — Notiz + Aufnahmen + Segmente + Job-Status.
- `PATCH /api/notes/:id`, `DELETE /api/notes/:id` (Dateien, Segmente, Jobs mit).
- `POST /api/notes/:id/recordings` — `{mimeType, startedAt}`; legt Aufnahme + Job an, liefert `{recordingId, expectedSeq: 0}`.
- `PUT /api/recordings/:id/chunks?seq=N` — `application/octet-stream`, eigener Content-Type-Parser mit
  `bodyLimit` 2 MB, wird angehängt. `seq < expected` → `200` (idempotent, nichts geschrieben),
  `seq > expected` → `409 {expectedSeq}`.
- `POST /api/recordings/:id/complete` — `{durationMs, byteSize}` → Status `ready`.
- `GET /api/recordings/:id/audio?token=…` — Range-fähig (`Accept-Ranges`, `206`, `Content-Range`, `416`),
  `Cache-Control: private, max-age=3600`. **Auth über kurzlebiges Signatur-Token**, weil `<audio src>`
  keinen Bearer-Header senden kann: `POST /api/recordings/:id/playback-token` → `{url, expiresAt}` (HMAC, 5 min).
- `PUT /api/recordings/:id/segments` — `[{idx,startMs,endMs,text}]`, ersetzt alles, Job → `done`,
  Fortschritt 100 %.
- `POST /api/transcription/jobs/claim` — ältester `pending`-Job des Nutzers, setzt `claimed` + Lease (60 s).
- `PATCH /api/transcription/jobs/:id` — `{status:'running'|'failed', progressMs?}`, verlängert die Lease.
- `GET /api/transcription/jobs?open=1` — für Batch-Verarbeitung und Fortschrittsanzeige.

Dateiablage: `config.audioDir` (Default `<DB_PATH-Verzeichnis>/audio`), Dateiname `randomUUID().ogg|.webm`,
Pfadprüfung wie bei den Avataren (`startsWith`, kein `..`), Größenprüfung gegen das Limit.
Löschen entfernt Datei und Zeilen.

Header: globaler `onSend`-Hook setzt `Cross-Origin-Opener-Policy: same-origin` und
`Cross-Origin-Embedder-Policy: require-corp`; im Dev-Server `server.headers` in `vite.config.ts`.

## Client

- `web/src/audio/recorder.ts` — `getUserMedia({channelCount:1, echoCancellation:false, noiseSuppression:false})`,
  `MediaRecorder` mit `audioBitsPerSecond: 128000` und `start(10_000)`, Format per `isTypeSupported`
  (Firefox `audio/ogg;codecs=opus`, Chromium `audio/webm;codecs=opus`). Zweiter Zweig:
  `AudioWorklet` → 16 kHz mono PCM, nur für die ASR.
- Aufnahme-Überwachung: `visibilitychange` (Firefox stoppt selbst), `track.onended/onmute`,
  `AnalyserNode`-RMS-Watchdog gegen „recording, aber Stille". Wake Lock anfordern und bei
  `visibilitychange` neu anfordern. `stop` bei erwartetem `recording` → Notiz `truncated` markieren.
- `web/src/workers/opfs.worker.ts` — `createSyncAccessHandle` (nur im Worker): Chunk-Puffer für
  Offline-Fälle und Modellablage. Ein append-only-File pro Aufnahme, 1–8 MiB-Writes, `flush()` selten.
- Uploader: pro Chunk idempotent (`seq`), Backoff, Treiber `online` + `visibilitychange` + Timer;
  kein Background Sync (in Firefox nicht implementiert).
- `web/src/asr/modelManager.ts` — Capability-Probe (`navigator.gpu`, `crossOriginIsolated`),
  Download von Hugging Face per Range (8 MiB, 4 parallel, Fortschritt = persistierte Bytes),
  sha256 aus einem eingecheckten Manifest, Ablage in OPFS unter `<modell>@<commit>/`.
- `web/src/workers/asr.worker.ts` — `parakeet.js@1.4.4`, `backend: 'webgpu' | 'wasm'`,
  `numThreads: 4`, `chunkLengthS: 60`, `returnTimestamps: true`. Fortschritt pro Fenster via `postMessage`.
- `web/src/asr/jobRunner.ts` — Claim (nur wenn Capability-Probe zustimmt), Lease-Heartbeat,
  Audio holen, dekodieren, transkribieren, Segmente `PUT`, bei Fehler `failed` + Retry-Zähler.

Modellwahl: WebGPU vorhanden → `w4a8` (383 MB); ohne WebGPU → `int8` (650 MB) mit Threads.
Der Versuch ist auf **allen** Geräten erlaubt, auch per WASM auf dem Handy — dort aber nur nach
ausdrücklicher Bestätigung, weil ein 650-MB-Modell im WASM-Heap den Tab töten kann und ein Absturz
nicht abfangbar ist. Laufzeit aus **einem** Paket: `parakeet.js` deckt beide Backends ab
(sherpa-onnx-WASM kann TDT nicht).

## UI

- Neuer Eintrag „Notizen" in `AppShell` + Route `/notes` in `App.tsx`.
- `NotesPage`: Aufnahme-Knopf, Liste nach Datum gruppiert, Status-Badge, Filter „unfertig", Suche.
- Detail als Popup-Karte (Muster `ModalStackProvider`): Titel (automatisch aus Datum + ersten Wörtern,
  editierbar), Player mit eigener Zeitleiste (Dauer aus `durationMs`, nicht aus dem Container),
  Segmentliste mit Klick-zum-Springen und Hervorhebung, Aktionen (umbenennen, verarbeiten, löschen).
  Wellenform erst später — sie kostet Dekodieren des ganzen Files.
- Aufnahme-Overlay: Pegel, Dauer, deutlicher Hinweis „Tab sichtbar und Bildschirm an lassen",
  Abbrechen/Stopp.
- `ProfilePage`: Abschnitt „Audio & Transkription" — Sprache, Modellstatus (Größe, geladen, löschen),
  „alle offenen Aufnahmen jetzt verarbeiten", Gerätefähigkeit.

## Tests

- Migration 11 → 12: neue Tabellen, `users.transcription_language` mit Default.
- Notizen: CRUD, Privatheit (fremder Nutzer und Admin → 404), Suche über Segmente.
- Upload: Reihenfolge (`409` bei Lücke), Idempotenz, Größenlimit, `complete`.
- Range: `206` mit `Content-Range`, `416` bei unerfüllbar, Signatur-Token abgelaufen → 401.
- Segmente: Ersetzen setzt Job auf `done`; fremde Aufnahme → 404.
- Jobs: Claim, Lease-Ablauf macht den Job wieder claimbar, Heartbeat verlängert.

## Risiken und Spikes (vor dem Bauen)

1. **Firefox-Speicher**: 650-MB-Modell im WASM-Heap, ~1,5–2,1 GB Spitze, 2-GB-Grenze für Views.
   Spike: echtes `int8`-Encoder-File in Firefox laden und Spitze messen. Fällt es um → Firefox
   ohne WebGPU nur „nicht verfügbar" (oder transformers.js whisper-small als Notnagel).
2. **int4 auf WASM** ist laut Messungen *langsamer* als int8 — wir nutzen `w4a8` deshalb nur mit WebGPU.
   Kurzer Spike im Zielbrowser, bevor die Modellwahl festgeschrieben wird.
3. **Ogg-Chunk-Anhängen**: prüfen, dass die aneinandergereihten Chunks in Firefox abspielbar sind
   und die Dauer aus `durationMs` die fehlende Container-Angabe ersetzt.
4. **COOP/COEP** gegen PWA/Service-Worker und Avatare testen; `crossOriginIsolated === true` prüfen,
   sonst laufen die Threads still einthreadig.

## Reihenfolge

1. Schema + Migration + Migrationstest.
2. Notizen-CRUD, Privatheit, Dateiablage, Range-Route, Playback-Token.
3. Aufnahme + Chunk-Upload + OPFS-Puffer + Overlay.
4. Job-Registry, Claim/Heartbeat, Fortschritt.
5. Modell-Manager (Download, Hash, OPFS) + Capability-Probe.
6. ASR-Worker + Segmente + Player.
7. Notiz-Seite, Karte, Einstellungen, Suche.
8. Header, PWA-Feinschliff, Tests grün, `AGENTS.md` nachziehen.
