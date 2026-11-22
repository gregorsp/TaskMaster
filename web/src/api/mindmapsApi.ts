import { crudApi } from "./crud";

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

export const mindmapsApi = crudApi<MindMapBoard, Omit<MindMapBoard, "id">>("/mindmaps");
