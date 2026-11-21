import client from "./client";

export interface TaskContext {
  id: string;
  name: string;
  color: string;
  createdById: string;
  createdAt: string;
}

export async function listContexts(): Promise<TaskContext[]> {
  const { data } = await client.get<TaskContext[]>("/contexts");
  return data;
}

export async function createContext(input: { name: string; color?: string }): Promise<TaskContext> {
  const { data } = await client.post<TaskContext>("/contexts", input);
  return data;
}

export async function updateContext(id: string, input: { name?: string; color?: string }): Promise<TaskContext> {
  const { data } = await client.put<TaskContext>(`/contexts/${id}`, input);
  return data;
}

export async function deleteContext(id: string): Promise<void> {
  await client.delete(`/contexts/${id}`);
}
