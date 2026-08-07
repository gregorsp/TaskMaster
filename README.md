# TaskMaster

> Gemeinsame Aufgabenverwaltung für Homelab-Familien – mit Kalender, Eisenhower-Matrix, Wiederholungen und PWA. Läuft auf dem Raspberry Pi (ARM64) in einem einzigen Docker-Container.

![Lizenz](https://img.shields.io/github/license/gregorsp/TaskMaster)
![CI](https://img.shields.io/github/actions/workflow/status/gregorsp/TaskMaster/ci.yml?label=CI)
![Image](https://img.shields.io/badge/Image-ghcr.io%2Fgregorsp%2Ftaskmaster-informational)

[English version](README.en.md)

---

## Inhaltsverzeichnis

- [Funktionen (implementiert)](#funktionen-implementiert)
- [Roadmap (geplant)](#roadmap-geplant)
- [Tech-Stack](#tech-stack)
- [Architektur](#architektur)
- [Schnellstart (Entwicklung)](#schnellstart-entwicklung)
- [Debugging](#debugging)
- [Tests](#tests)
- [Deployment (CasaOS / Raspberry Pi)](#deployment-casaos--raspberry-pi)
- [Konfiguration](#konfiguration)
- [API-Übersicht](#api-übersicht)
- [Projektstruktur](#projektstruktur)
- [Mitmachen](#mitmachen)
- [Hinweis zur KI-Unterstützung](#hinweis-zur-ki-unterstützung)
- [Lizenz](#lizenz)

---

## Funktionen (implementiert)

- **Nutzer & Rollen** – Registrierung, Login und Admin-Rollen; Admins verwalten Nutzer (Rolle ändern, löschen)
- **Aufgaben** – Titel, Beschreibung, Fälligkeit (Datum + optionale Uhrzeit), mehrere Verantwortliche, Kategorien (Tags)
- **Wiederholungen** – drei Typen:
  - *Einmalig*: wird abgeschlossen und bleibt erledigt
  - *Regelmäßig* (RRULE / RFC 5545): z. B. „alle 2 Wochen mittwochs", „jeden 3. Mittwoch im Monat", „immer am 1. des Monats"
  - *Bei Erledigung*: Nach dem Abschließen gibst du an, wann die Aufgabe das nächste Mal ansteht
- **Sichtbarkeit** – Private Aufgaben sehen nur Ersteller, zugewiesene Nutzer und Admins (serverseitig gefiltert)
- **Kalender** – Monats- und Wochenansicht inkl. berechneter Wiederholungstermine
- **Eisenhower-Matrix** – Aufgaben per Drag & Drop in 4 Quadranten sortieren (wichtig/dringend)
- **Überfällige Aufgaben** – roter Badge in der Kopfzeile (Polling), eigene Seite und Toast nach dem Login
- **Task-Verlauf** – Chronologie, wer wann erledigt oder wieder geöffnet hat, plus Kommentare pro Aufgabe
- **Kategorien** – Farbpalette, eigener Farbwähler und automatische Farbe mit maximalem Abstand zu bestehenden
- **Dunkelmodus** – Light/Dark-Umschalter in der Kopfzeile (wird im Browser gespeichert)
- **PWA** – Auf dem Handy als App installierbar, Offline-Caching via Service Worker
- **REST-API** – JWT-Auth (Access-Token 15 min, Refresh-Token 7 Tage als HttpOnly-Cookie)

## Roadmap (geplant)

Nicht umgesetzt, aber angedacht:

- **Benachrichtigungen** (E-Mail/Push) bei Fälligkeit und Überfälligkeit
- **iCal-Import/-Export** (dank RRULE nahezu trivial)
- **Sub-Tasks / Checklisten**
- **Internationalisierung (i18n)** – die UI ist aktuell nur auf Deutsch
- **Task-Attachments** – Dateien/Notizen an Aufgaben hängen

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Backend | Node.js 24 + TypeScript + Fastify |
| Datenbank | SQLite via sql.js (WASM, keine nativen Module) + Drizzle ORM |
| Migrationen | Drizzle Kit |
| Frontend | React 19 + Vite + MUI 7 + Tailwind 4 |
| Auth | JWT (fastify-jwt) + scrypt + HttpOnly-Cookies |
| Wiederholungen | rrule (RFC 5545) |
| Drag & Drop | dnd-kit |
| PWA | vite-plugin-pwa |
| Deployment | Docker (Multi-Arch: `linux/arm64` + `linux/amd64`), Image auf GHCR |

## Architektur

TaskMaster ist ein **Single-Container-Design**:

- Der Fastify-Server stellt die REST-API unter `/api/*` **und** die gebaute React-App (SPA, Fallback auf `index.html`) aus.
- Die Datenbank ist eine SQLite-**Datei** (kein separater DB-Prozess) im Docker-Volume `/app/data`.
- `sql.js` ist ein WebAssembly-Treiber ohne native Module – dadurch läuft das Image auf **ARM64 (Raspberry Pi)** und AMD64 völlig identisch, ohne Kompilier-Toolchain.
- Die Wiederholungslogik basiert auf `rrule` (RFC 5545). Wiederkehrende Aufgaben speichern ihre Regel und ihr Startdatum; aktuelle/überfällige Termine werden zur Laufzeit berechnet.

## Schnellstart (Entwicklung)

Voraussetzungen: Node.js 24 + npm.

```bash
# 1. Backend starten
cd server
npm install
npm run db:migrate          # Datenbankschema anlegen
npm run db:seed             # Admin anlegen: admin@taskmaster.local / admin123
npm run dev                 # http://localhost:8080

# 2. Frontend starten (zweites Terminal)
cd web
npm install
npm run dev                 # http://localhost:5173 (proxied /api zu 8080)
```

## Debugging

- **Docker-Logs**: `docker compose logs -f taskmaster`
- **VSCode**: Das Repo enthält `.vscode/launch.json` mit zwei Konfigurationen – „Debug Server (tsx)" (Hot-Reload) und „Debug Server (gebaut)".
- **Server-Logs**: Fastify/Pino gibt strukturierte JSON-Logs aus; im Development-Modus ausführlicher.
- **Tests im Watch-Modus**: `cd server && npm run test:watch`
- **Frontend**: Vite bietet Hot Module Replacement; Browser-DevTools zum Prüfen von API-Calls (Bearer-Token) und Auth-Cookies.
  - **Wichtig bei der PWA**: Nach Änderungen ggf. hart neu laden (Ctrl/Cmd+Shift+R) oder den Service Worker in den DevTools deaktivieren, damit alter Cache nicht stört.
- **Healthcheck**: `curl http://localhost:8080/api/health` → `{"status":"ok"}`

## Tests

```bash
cd server
npm test        # Vitest mit In-Memory-Datenbank (32 Tests)
```

Abgedeckt werden u. a. Auth-Flow (Login/Refresh), Aufgaben-CRUD, Sichtbarkeit privater Aufgaben, Wiederholungslogik und Kategorien.

## Deployment (CasaOS / Raspberry Pi)

Es gibt zwei Wege – für den Pi empfohlen ist **Variante A** (kein Build auf dem Gerät).

### Variante A: Fertiges Image von GHCR ziehen (empfohlen)

GitHub Actions baut nach jedem Push ein Multi-Arch-Image und veröffentlicht es als
`ghcr.io/gregorsp/taskmaster:latest`. Der Pi lädt nur noch das fertige Image.

```bash
git clone https://github.com/gregorsp/TaskMaster.git
cd TaskMaster

# Konfiguration anlegen und JWT_SECRET setzen (siehe "Konfiguration")
cp .env.example .env
# JWT_SECRET in .env auf einen zufälligen Wert setzen, z. B.:
#   openssl rand -hex 32

docker compose up -d
# → http://<pi-ip>:8080
```

**Unter CasaOS**: Compose-Dateien lassen sich über „Meine Apps" importieren bzw. als
eigene App definieren (gleicher Inhalt wie `docker-compose.yml`). Host-Port,
Umgebungsvariablen und Volumes lassen sich dann über die CasaOS-Oberfläche anpassen.

**Update auf eine neue Version**:

```bash
git pull
docker compose pull && docker compose up -d
```

### Variante B: Aus dem Quellcode bauen

Ohne Registry bzw. vor dem ersten CI-Build – das Image wird lokal gebaut
(auf dem Pi dauert das je nach Modell einige Minuten):

```bash
git clone https://github.com/gregorsp/TaskMaster.git
cd TaskMaster
cp .env.example .env        # JWT_SECRET setzen!
docker compose up -d --build
```

### Erster Login

Beim allerersten Start legt der Server automatisch einen Admin an, sofern noch keine
Nutzer existieren:

- E-Mail: `ADMIN_EMAIL` (Default: `admin@taskmaster.local`)
- Passwort: `ADMIN_PASSWORD` (Default: `admin123` – **in Produktion ändern!**)

### Reverse Proxy / TLS (empfohlen)

CasaOS liefert gern Caddy oder Traefik als Reverse-Proxy mit. Damit erreichst du die
App über `https://taskmaster.<deine-domain>` und bekommst automatisch TLS:

```
taskmaster.<deine-domain> {
    reverse_proxy 127.0.0.1:8080
}
```

Bei `NODE_ENV=production` wird das Refresh-Cookie mit `Secure` gesetzt – über HTTPS
funktioniert der Login dann wie vorgesehen.

### Backup

Die Daten liegen in der SQLite-Datei im Docker-Volume `taskmaster_data`. Backup:

```bash
docker run --rm \
  -v taskmaster_data:/app/data \
  -v "$(pwd):/backup" \
  alpine tar czf /backup/taskmaster-backup-$(date +%F).tgz -C /app/data .
```

## Konfiguration

Alle Einstellungen laufen über **Umgebungsvariablen**. Die kommentierte Vorlage liegt
als [`.env.example`](.env.example) im Repo-Stamm – `cp .env.example .env` und anpassen.
Unter CasaOS setzt du dieselben Variablen in den App-Einstellungen des Containers.

| Variable | Default | Beschreibung |
|---|---|---|
| `JWT_SECRET` | `change-me-in-production` | Signatur-Secret der Tokens. **Pflicht in Produktion** (mind. 16 Zeichen). Erzeugen: `openssl rand -hex 32` |
| `JWT_ACCESS_TTL` | `15m` | Lebensdauer des Access-Tokens (ms-Format, z. B. `15m`, `1h`) |
| `JWT_REFRESH_TTL` | `7d` | Lebensdauer des Refresh-Tokens (z. B. `7d`, `30d`) |
| `ADMIN_EMAIL` | `admin@taskmaster.local` | E-Mail des initialen Admin-Kontos (nur erster Start) |
| `ADMIN_PASSWORD` | `admin123` | Passwort des initialen Admin-Kontos – **ändern!** |
| `PORT` | `8080` | HTTP-Port (im Container) |
| `HOST` | `0.0.0.0` | Bind-Adresse (Container-intern) |
| `DB_PATH` | `./data/taskmaster.db` | Pfad zur SQLite-Datei; im Container: `/app/data/taskmaster.db` |
| `NODE_ENV` | `development` | `development` / `production` / `test` – steuert Logger, CORS und Cookie-Flags |

Erläuterungen:

- **`JWT_SECRET`** ist die wichtigste Variable. Ein bekanntes Secret erlaubt das Fälschen
  von Tokens. Generieren mit `openssl rand -hex 32` und in `.env` eintragen.
- **`docker-compose.yml`** ist vollständig kommentiert (Ports, Volume, Healthcheck,
  Neustart-Verhalten) und unterstützt beide Betriebsarten: Image-Pull und lokalen Build.
- **`server/src/config.ts`** validiert die Variablen beim Start (zod): ungültige Werte
  beenden den Prozess mit einer klaren Meldung statt mit obskuren Fehlern zur Laufzeit.

## API-Übersicht

Alle Endpunkte außer `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh` und
`/api/health` benötigen `Authorization: Bearer <access-token>`.
Fehlerantworten sind einheitlich: `{ "error": { "code", "message" } }`.

| Methode | Route | Beschreibung | Zugriff |
|---|---|---|---|
| POST | `/api/auth/register` | Registrierung | öffentlich |
| POST | `/api/auth/login` | Login → Access-Token + Refresh-Cookie | öffentlich |
| POST | `/api/auth/refresh` | Access-Token erneuern (Cookie) | öffentlich |
| POST | `/api/auth/logout` | Refresh-Cookie löschen | angemeldet |
| GET | `/api/auth/me` | Aktueller Nutzer | angemeldet |
| GET | `/api/health` | Lebend-Check | öffentlich |
| GET | `/api/tasks` | Aufgabenliste (Filter, Pagination, Suche) | angemeldet |
| GET | `/api/tasks/overdue` | Überfällige Aufgaben | angemeldet |
| POST | `/api/tasks` | Aufgabe erstellen | angemeldet |
| GET | `/api/tasks/:id` | Einzelne Aufgabe | sichtbar |
| PUT | `/api/tasks/:id` | Aufgabe bearbeiten | sichtbar |
| DELETE | `/api/tasks/:id` | Aufgabe löschen | sichtbar |
| POST | `/api/tasks/:id/complete` | Abschließen (Body: `nextDueAt?`, `comment?`) | sichtbar |
| POST | `/api/tasks/:id/reopen` | Wieder öffnen (nur einmalig) | sichtbar |
| GET | `/api/tasks/:id/events` | Verlauf (Erledigt/Wieder geöffnet/Kommentare) | sichtbar |
| POST | `/api/tasks/:id/comment` | Kommentar hinzufügen | sichtbar |
| GET | `/api/calendar?from=&to=` | Kalendereinträge inkl. Wiederholungsterminen | angemeldet |
| GET | `/api/categories` | Kategorien | angemeldet |
| POST | `/api/categories` | Kategorie anlegen (Body: `{ name, color? }`) | angemeldet |
| PUT | `/api/categories/:id` | Kategorie bearbeiten | angemeldet |
| DELETE | `/api/categories/:id` | Kategorie löschen | angemeldet |
| GET | `/api/users` | Alle Nutzer | Admin |
| GET | `/api/users/picker` | Nutzerliste für Zuweisung | angemeldet |
| GET | `/api/users/:id` | Einzelner Nutzer | Admin |
| PUT | `/api/users/:id` | Nutzer bearbeiten (Rolle, Passwort …) | Admin |
| DELETE | `/api/users/:id` | Nutzer löschen | Admin |

## Projektstruktur

```
TaskMaster/
├── .env.example           # Kommentierte Vorlage der Umgebungsvariablen
├── .github/workflows/     # CI (Build+Test) und Publish (GHCR Multi-Arch)
├── Dockerfile             # Multi-Stage: Web-Build → Server-Build → Runtime
├── docker-compose.yml     # Kommentiertes Compose für Homelab/CasaOS
├── CONTRIBUTING.md
├── LICENSE                # GPL-3.0
├── server/                # Fastify + TypeScript Backend
│   ├── src/
│   │   ├── config.ts      # Env-Konfiguration (zod, kommentiert)
│   │   ├── db/            # Schema, Migrationen, Client, Seed
│   │   ├── modules/       # Auth, Tasks, Categories, Users, Calendar
│   │   └── middleware/    # JWT-Guards, Sichtbarkeitsfilter, Error-Handler
│   └── test/              # Vitest (32 Tests, In-Memory-DB)
└── web/                   # React 19 + Vite + MUI PWA
    └── src/
        ├── api/           # Axios-Clients (401-Refresh-Interceptor)
        ├── components/    # Layout, Tasks, Auth …
        ├── context/       # Auth, Theme, Notify
        ├── hooks/         # u. a. useOverdueCount (Polling 60 s)
        └── pages/         # Dashboard, Kalender, Matrix, Kategorien, Überfällig, Admin
```

## Mitmachen

Beiträge sind willkommen! Ein kurzer Leitfaden (Fork, Branches, Qualitätschecks,
Conventional Commits) steht in [CONTRIBUTING.md](CONTRIBUTING.md). Für Bugs und
Feature-Wünsche nutze bitte die GitHub Issues.

## Hinweis zur KI-Unterstützung

Dieses Projekt wurde mit Unterstützung durch **opencode** und das Sprachmodell
**DeepSeek v4** (Variante **Flash** und **Pro**) entwickelt.

## Lizenz

[GPL-3.0](LICENSE) © 2026 Moritz (gregorsp).
