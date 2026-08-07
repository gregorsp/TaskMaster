import client, { setAccessToken } from "./client";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
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
