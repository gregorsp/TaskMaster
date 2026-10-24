import { z } from "zod";

export const createNoteSchema = z
  .object({
    kind: z.enum(["text", "audio"]),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(20_000).optional(),
  })
  .refine((value) => value.kind === "audio" || (value.body ?? "").trim().length > 0, {
    message: "Text-Notizen brauchen einen Text",
    path: ["body"],
  });

export const updateNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(20_000).nullable().optional(),
});

export const listNotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().optional(),
  q: z.string().trim().max(200).optional(),
  filter: z.enum(["all", "open"]).default("all"),
});
