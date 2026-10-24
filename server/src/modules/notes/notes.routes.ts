import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { createNoteSchema, listNotesQuerySchema, updateNoteSchema } from "./notes.schema.js";
import { createNote, deleteNote, getNoteDetail, listNotes, updateNote } from "./notes.service.js";
import { createRecording } from "../recordings/recordings.service.js";

const createRecordingSchema = z.object({
  mimeType: z.string().min(1).max(120),
  startedAt: z.string().datetime().optional(),
});

function notFound(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Notiz nicht gefunden" } });
}

export async function notesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const user = request.user as { id: string };
    const query = listNotesQuerySchema.parse(request.query ?? {});
    return listNotes(user.id, query);
  });

  app.post("/", async (request, reply) => {
    const user = request.user as { id: string };
    const input = createNoteSchema.parse(request.body ?? {});
    const note = createNote(user.id, input);
    return reply.status(201).send(note);
  });

  app.get("/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const note = getNoteDetail(user.id, id);
    if (!note) return notFound(reply);
    return note;
  });

  app.patch("/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const patch = updateNoteSchema.parse(request.body ?? {});
    const note = updateNote(user.id, id, patch);
    if (!note) return notFound(reply);
    return note;
  });

  app.delete("/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    if (!deleteNote(user.id, id)) return notFound(reply);
    return { ok: true };
  });

  app.post("/:id/recordings", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = createRecordingSchema.parse(request.body ?? {});
    const recording = createRecording(user.id, "note", id, {
      mimeType: input.mimeType,
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
    });
    return reply.status(201).send(recording);
  });
}
