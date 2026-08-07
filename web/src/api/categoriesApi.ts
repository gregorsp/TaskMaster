import client from "./client";

export interface Category {
  id: string;
  name: string;
  color: string;
  createdById: string;
  createdAt: string;
}

export async function listCategories(): Promise<Category[]> {
  const { data } = await client.get<Category[]>("/categories");
  return data;
}

export async function createCategory(input: { name: string; color?: string }): Promise<Category> {
  const { data } = await client.post<Category>("/categories", input);
  return data;
}

export async function updateCategory(id: string, input: { name?: string; color?: string }): Promise<Category> {
  const { data } = await client.put<Category>(`/categories/${id}`, input);
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  await client.delete(`/categories/${id}`);
}
