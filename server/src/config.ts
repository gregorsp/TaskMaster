import { z } from "zod";

/**
 * TaskMaster – Server-Konfiguration.
 *
 * Alle Einstellungen werden über Umgebungsvariablen gesetzt (siehe `.env.example`
 * im Projektstamm und den Abschnitt "Konfiguration" der README). Das Schema wird
 * beim Start geparst: Fehlende Werte fallen auf die hier definierten Defaults
 * zurück, ungültige Werte beenden den Prozess mit einer klaren Fehlermeldung.
 */
const envSchema = z.object({
  /**
   * Port, auf dem der HTTP-Server lauscht.
   * Im Docker-Container ist dies standardmäßig 8080 (siehe EXPOSE im Dockerfile).
   */
  PORT: z.coerce.number().default(8080),

  /**
   * Bind-Adresse. 0.0.0.0 ist wichtig im Container, damit der Server auch von
   * außen (bzw. vom Reverse-Proxy) erreichbar ist – nicht nur innerhalb des Containers.
   */
  HOST: z.string().default("0.0.0.0"),

  /**
   * Pfad zur SQLite-Datei (sql.js). Im Container zeigt dieser auf das Volume
   * `/app/data/taskmaster.db`, damit die Daten Neustarts überleben.
   * In der Test-Umgebung wird automatisch eine In-Memory-Datenbank verwendet.
   */
  DB_PATH: z.string().default("./data/taskmaster.db"),

  /**
   * Geheimnis zum Signieren der JWT-Tokens (Access + Refresh).
   * MUSS in Produktion gesetzt werden (mindestens 16 Zeichen) – z. B. erzeugt mit
   * `openssl rand -hex 32`. Ein bekanntes/geknacktes Secret erlaubt Token-Fälschung.
   */
  JWT_SECRET: z.string().min(16).default("change-me-in-production-123456"),

  /**
   * Lebensdauer des Access-Tokens (fastify-jwt akzeptiert ms-Strings wie "15m", "1h").
   * Kurz halten: Das Token liegt im Browser-Speicher und gilt nur für die API-Aufrufe.
   */
  JWT_ACCESS_TTL: z.string().default("15m"),

  /**
   * Lebensdauer des Refresh-Tokens. Liegt als HttpOnly-Cookie und erneuert das
   * Access-Token. 7 Tage ist ein guter Kompromiss zwischen Komfort und Sicherheit.
   */
  JWT_REFRESH_TTL: z.string().default("7d"),

  /**
   * Laufzeit-Umgebung. Beeinflusst unter anderem:
   * - development: ausführlicher Fastify-Logger, CORS erlaubt localhost:5173,
   *   Refresh-Cookie ohne "Secure"-Flag (läuft über HTTP lokal)
   * - production:  schlanker Logger, Refresh-Cookie mit "Secure"-Flag
   * - test:        In-Memory-Datenbank statt Datei
   */
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  /** HTTP-Port */
  port: parsed.PORT,
  /** Bind-Adresse des HTTP-Servers */
  host: parsed.HOST,
  /** Pfad zur SQLite-Datei (":memory:" im Test-Modus) */
  dbPath: parsed.NODE_ENV === "test" ? ":memory:" : parsed.DB_PATH,
  /** JWT-Signatur-Secret */
  jwtSecret: parsed.JWT_SECRET,
  /** Lebensdauer des Access-Tokens (z. B. "15m") */
  accessTtl: parsed.JWT_ACCESS_TTL,
  /** Lebensdauer des Refresh-Tokens (z. B. "7d") */
  refreshTtl: parsed.JWT_REFRESH_TTL,
  /** true im Development-Modus */
  isDev: parsed.NODE_ENV === "development",
  /** true im Production-Modus */
  isProd: parsed.NODE_ENV === "production",
};
