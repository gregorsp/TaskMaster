import { FastifyInstance } from "fastify";
import { authGuard, adminGuard } from "../../middleware/auth.hooks.js";
import { getDbState, SCHEMA_VERSION } from "../../db/version.js";
import { getDb, getRawDb, restoreDb } from "../../db/client.js";
import { createBackup, runMigration } from "../../db/migrations.js";

export interface MigrationRouteOptions {
  /**
   * Wird aufgerufen, nachdem die Migration erfolgreich durchgelaufen ist und die
   * Antwort beim Client angekommen ist. Der Server startet sich damit selbst neu
   * – die Routen stehen beim Start fest, ein laufender Prozess kann den
   * Wartungsmodus nicht verlassen.
   */
  onMigrationDone?: () => void;
}

export async function migrationRoutes(app: FastifyInstance, options: MigrationRouteOptions) {
  const restartAfterReply = (reply: { raw: { once: (event: string, listener: () => void) => void } }) => {
    if (!options.onMigrationDone) return;
    const done = () => {
      // Kurz warten: der Client soll die Erfolgsmeldung noch bekommen, bevor
      // der Prozess verschwindet.
      setTimeout(() => options.onMigrationDone?.(), 250);
    };
    try {
      reply.raw.once("finish", done);
    } catch {
      done();
    }
  };

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
        restartAfterReply(reply);
        return reply.send({
          success: true,
          restarting: options.onMigrationDone !== undefined,
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
