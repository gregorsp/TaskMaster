import client from "./client";

/** Einheitliche CRUD-Aufrufe für einfache, nutzereigene Ressourcen (Ziele, Zeitblöcke, Mindmaps). */
export function crudApi<T, CreateInput, UpdateInput = Partial<CreateInput>, Created = T>(path: string) {
  return {
    list: async () => (await client.get<T[]>(path)).data,
    create: async (input: CreateInput) => (await client.post<Created>(path, input)).data,
    update: async (id: string, input: UpdateInput) => (await client.put<T>(`${path}/${id}`, input)).data,
    remove: async (id: string) => { await client.delete(`${path}/${id}`); },
  };
}
