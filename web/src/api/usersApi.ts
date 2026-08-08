import client from "./client";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  profilePicture: string | null;
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

export async function uploadUserProfilePicture(userId: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post<{ profilePicture: string }>(`/users/${userId}/profile-picture`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.profilePicture;
}

export async function deleteUserProfilePicture(userId: string): Promise<void> {
  await client.delete(`/users/${userId}/profile-picture`);
}
