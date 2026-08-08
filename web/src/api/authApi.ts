import client, { setAccessToken } from "./client";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  profilePicture: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>("/auth/login", { email, password });
  setAccessToken(data.accessToken);
  return data;
}

export async function register(input: {
  username: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<{ user: User }> {
  const { data } = await client.post<{ user: User }>("/auth/register", input);
  return data;
}

export async function refresh(): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>("/auth/refresh");
  setAccessToken(data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  await client.post("/auth/logout");
  setAccessToken(null);
}

export async function me(): Promise<User> {
  const { data } = await client.get<{ user: User }>("/auth/me");
  return data.user;
}

export async function updateProfile(input: {
  displayName?: string;
  email?: string;
}): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me", input);
  return data.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await client.put("/auth/me/password", { currentPassword, newPassword });
}

export async function uploadProfilePicture(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post<{ profilePicture: string }>("/auth/me/profile-picture", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data.profilePicture;
}

export async function deleteProfilePicture(): Promise<void> {
  await client.delete("/auth/me/profile-picture");
}
