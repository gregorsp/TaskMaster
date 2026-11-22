// Kopiert den fertigen Build (web/dist) nach server/public, damit der
// Fastify-Server auf Port 8080 immer den aktuellen Stand ausliefert.
// Läuft automatisch als "postbuild". Im Docker-Build gibt es kein ../server
// (web liegt dort allein unter /app) — dann wird nichts getan.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(webDir, "dist");
const serverDir = resolve(webDir, "..", "server");
const publicDir = resolve(serverDir, "public");

if (!existsSync(resolve(serverDir, "package.json"))) {
  console.log("[copy-to-server] Kein ../server gefunden – überspringe Kopieren.");
  process.exit(0);
}
if (!existsSync(distDir)) {
  console.error("[copy-to-server] web/dist fehlt – erst bauen.");
  process.exit(1);
}

rmSync(publicDir, { recursive: true, force: true });
cpSync(distDir, publicDir, { recursive: true });
console.log(`[copy-to-server] ${distDir} -> ${publicDir}`);
