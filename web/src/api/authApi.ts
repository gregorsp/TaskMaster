import client, { setAccessToken } from "./client";

/** Persönliche Pomodoro-Einstellungen (Server liefert immer vollständige Werte). */
export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Nach so vielen Pomodoros folgt die lange Pause. */
  longBreakEvery: number;
  sound: boolean;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, sound: true,
};

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  profilePicture: string | null;
  capacity: Record<string, number> | null;
  pomodoroSettings: PomodoroSettings;
  confirmHabitCompletion: boolean;
  transcriptionLanguage: string;
  defaultPrivate: boolean;
  aiProvider: "gemini" | "deepseek" | null;
  hasAiKey: boolean;
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

export async function fetchCapacity(): Promise<Record<string, number> | null> {
  const { data } = await client.get<{ capacity: Record<string, number> | null }>("/auth/me/capacity");
  return data.capacity;
}

export async function updateCapacity(capacity: Record<string, number> | null): Promise<Record<string, number> | null> {
  const { data } = await client.put<{ capacity: Record<string, number> | null }>("/auth/me/capacity", { capacity });
  return data.capacity;
}

export async function updateHabitConfirm(confirmHabitCompletion: boolean): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me/habit-confirm", { confirmHabitCompletion });
  return data.user;
}

export async function updateTranscriptionLanguage(
  transcriptionLanguage: "de" | "en" | "auto"
): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me/transcription-language", {
    transcriptionLanguage,
  });
  return data.user;
}

export async function updatePomodoroSettings(settings: PomodoroSettings): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me/pomodoro-settings", settings);
  return data.user;
}

export async function updateDefaultPrivate(defaultPrivate: boolean): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me/default-private", { defaultPrivate });
  return data.user;
}

export async function saveAiKey(provider: "gemini" | "deepseek", key: string): Promise<User> {
  const { data } = await client.put<{ user: User }>("/auth/me/ai-key", { provider, key });
  return data.user;
}

export async function clearAiKey(): Promise<User> {
  const { data } = await client.delete<{ user: User }>("/auth/me/ai-key");
  return data.user;
}
