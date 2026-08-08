import { FastifyInstance } from "fastify";
import { authGuard, adminGuard } from "../../middleware/auth.hooks.js";
import { getDbState, SCHEMA_VERSION } from "../../db/version.js";
import { getDb, getRawDb, restoreDb } from "../../db/client.js";
import { createBackup, runMigration } from "../../db/migrations.js";

export async function migrationRoutes(app: FastifyInstance) {
  app.get(
    "/status",
    { preHandler: [authGuard, adminGuard] },
    async (_request, reply) => {
      const state = getDbState(getDb(), getRawDb());
      return reply.send({
        migrationRequired: state.state === "MIGRATION_NEEDED",
        currentVersion: state.currentVersion,
        targetVersion: SCHEMA_VERSION,
        state: state.state,
      });
    },
  );

  app.post(
    "/run",
    { preHandler: [authGuard, adminGuard] },
    async (_request, reply) => {
      const state = getDbState(getDb(), getRawDb());
      if (state.state !== "MIGRATION_NEEDED") {
        return reply.send({
          success: true,
          message: "Database is already up to date.",
          currentVersion: state.currentVersion,
          targetVersion: SCHEMA_VERSION,
        });
      }

      let backupPath = "";
      try {
        backupPath = createBackup();
        runMigration();
        return reply.send({
          success: true,
          message: `Migration complete (v${state.currentVersion} → v${SCHEMA_VERSION}). Backup: ${backupPath || "none"}`,
          currentVersion: SCHEMA_VERSION,
          targetVersion: SCHEMA_VERSION,
          backupPath,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (backupPath) {
          try {
            await restoreDb(backupPath);
          } catch (restoreErr) {
            return reply.status(500).send({
              success: false,
              message: `Migration failed AND backup restore failed: ${message}. Restore error: ${String(restoreErr)}`,
            });
          }
        }

        return reply.status(500).send({
          success: false,
          message: `Migration failed: ${message}.${backupPath ? " Database restored from backup." : ""}`,
        });
      }
    },
  );
}
