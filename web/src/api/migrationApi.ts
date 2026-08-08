import client from "./client";

export interface MigrationStatus {
  migrationRequired: boolean;
  currentVersion: number;
  targetVersion: number;
  state: string;
}

export interface MigrationResult {
  success: boolean;
  message: string;
  currentVersion: number;
  targetVersion: number;
  backupPath?: string;
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const { data } = await client.get<MigrationStatus>("/migration/status");
  return data;
}

export async function runMigration(): Promise<MigrationResult> {
  const { data } = await client.post<MigrationResult>("/migration/run");
  return data;
}
