import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { mindmapBoards } from "../../db/schema.js";
import { findOwned } from "../../lib/owned.js";

/**
 * Brainstorming-Boards. Der Server speichert Knoten und Querverbindungen als
 * JSON, ohne ihre Struktur auszuwerten – die Logik bleibt im Board-Editor.
 */
export interface BoardContent {
  nodes: unknown[];
  extraEdges: unknown[];
}

function toDto(row: typeof mindmapBoards.$inferSelect) {
  const content = JSON.parse(row.nodes) as BoardContent;
  return { id: row.id, title: row.title, nodes: content.nodes ?? [], extraEdges: content.extraEdges ?? [], updatedAt: row.updatedAt };
}

export function listBoards(userId: string) {
  return getDb().select().from(mindmapBoards).where(eq(mindmapBoards.userId, userId)).all()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(toDto);
}

export function createBoard(userId: string, input: { title: string } & BoardContent) {
  const now = new Date();
  const row = {
    id: uuid(), userId, title: input.title.trim(),
    nodes: JSON.stringify({ nodes: input.nodes, extraEdges: input.extraEdges }),
    createdAt: now, updatedAt: now,
  };
  getDb().insert(mindmapBoards).values(row).run();
  return toDto(row);
}

export function updateBoard(id: string, userId: string, input: Partial<{ title: string } & BoardContent>) {
  const current = toDto(findOwned(mindmapBoards, id, userId, "Board"));
  const patch: Partial<typeof mindmapBoards.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.nodes !== undefined || input.extraEdges !== undefined) {
    patch.nodes = JSON.stringify({
      nodes: input.nodes ?? current.nodes,
      extraEdges: input.extraEdges ?? current.extraEdges,
    });
  }
  getDb().update(mindmapBoards).set(patch).where(eq(mindmapBoards.id, id)).run();
  return toDto(findOwned(mindmapBoards, id, userId, "Board"));
}

export function deleteBoard(id: string, userId: string) {
  findOwned(mindmapBoards, id, userId, "Board");
  getDb().delete(mindmapBoards).where(eq(mindmapBoards.id, id)).run();
}
