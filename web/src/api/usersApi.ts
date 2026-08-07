import client from "./client";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface UserPickerItem {
  id: string;
  username: string;
  displayName: string;
}

export async function listUsers(): Promise<User[]> {
  const { data } = await client.get<User[]>("/users");
  return data;
}

export async function listUsersPicker(): Promise<UserPickerItem[]> {
  const { data } = await client.get<UserPickerItem[]>("/users/picker");
  return data;
}

export async function getUser(id: string): Promise<User> {
  const { data } = await client.get<User>(`/users/${id}`);
  return data;
}

export async function updateUser(id: string, input: {
  username?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  password?: string;
}): Promise<User> {
  const { data } = await client.put<User>(`/users/${id}`, input);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await client.delete(`/users/${id}`);
}
