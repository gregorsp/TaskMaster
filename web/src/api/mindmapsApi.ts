import client from "./client";

export interface MindNode {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  /** Aufgabe, die aus diesem Knoten entstanden ist. */
  gtdTaskId?: string;
  parentId: string | null;
}

export interface MindEdge {
  from: string;
  to: string;
  dashed?: boolean;
}

export interface MindMapBoard {
  id: string;
  title: string;
  nodes: MindNode[];
  extraEdges: MindEdge[];
}

type BoardContent = Omit<MindMapBoard, "id">;

export const mindmapsApi = {
  list: async () => (await client.get<MindMapBoard[]>("/mindmaps")).data,
  create: async (input: BoardContent) => (await client.post<MindMapBoard>("/mindmaps", input)).data,
  update: async (id: string, input: Partial<BoardContent>) => (await client.put<MindMapBoard>(`/mindmaps/${id}`, input)).data,
  remove: async (id: string) => { await client.delete(`/mindmaps/${id}`); },
};
