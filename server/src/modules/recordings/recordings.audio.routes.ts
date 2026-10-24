import { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createReadStream, existsSync, statSync } from "node:fs";
import { getDb } from "../../db/client.js";
import { recordings } from "../../db/schema.js";
import { audioFilePath } from "./audio.storage.js";
import { parsePlaybackToken } from "./playback.token.js";

/**
 * Audioauslieferung ohne Bearer-Token: `<audio src>` kann keine Header setzen,
 * deshalb kommt die Autorisierung als kurzlebiges, signiertes Query-Token.
 * Range wird unterstützt, damit der Player springen kann (Safari verweigert
 * das Wiedergeben ohne Range-Unterstützung).
 */
export async function recordingAudioRoutes(app: FastifyInstance) {
  app.get("/:id/audio", async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = (request.query as { token?: string } | undefined)?.token;
    const payload = token ? parsePlaybackToken(token) : null;

    if (!payload || payload.recordingId !== id) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Ungültiges oder abgelaufenes Abspiel-Token" },
      });
    }

    const recording = getDb()
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.userId, payload.userId)))
      .get();

    if (!recording) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Aufnahme nicht gefunden" } });
    }

    const filePath = audioFilePath(recording.filename);
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Audiodatei fehlt" } });
    }

    const size = statSync(filePath).size;
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", recording.mimeType);
    reply.header("Cache-Control", "private, max-age=3600");

    const range = request.headers.range;
    if (!range) {
      reply.header("Content-Length", String(size));
      return reply.send(createReadStream(filePath));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.status(416).send();
    }

    let start: number;
    let end: number;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      reply.header("Content-Range", `bytes */${size}`);
      return reply.status(416).send();
    }

    end = Math.min(end, size - 1);
    reply.status(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
    reply.header("Content-Length", String(end - start + 1));
    return reply.send(createReadStream(filePath, { start, end }));
  });
}
