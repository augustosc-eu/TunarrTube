export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    // Before the worker starts, so no job is writing into the folders being renamed. A failure here is
    // logged and never blocks startup: the app still works, the old folders just stay where they are.
    try {
      const { migrateLegacyStorageNames } = await import("@/lib/maintenance/legacy-names");
      await migrateLegacyStorageNames();
    } catch (error) {
      const { sanitizeLogValue } = await import("@/lib/logging/sanitize");
      console.error(sanitizeLogValue(`Legacy storage-name migration failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    // Old YTARR_* names still work (lib/config/env.ts), but tell the operator once so they can rename them.
    const { legacyEnvironmentInUse } = await import("@/lib/config/env");
    const legacy = legacyEnvironmentInUse();
    if (legacy.length) {
      const message = `Deprecated environment variables: ${legacy.map((item) => item.ignored
        ? `${item.legacy} (ignored, ${item.current} is set)`
        : `${item.legacy} (rename to ${item.current})`).join(", ")}.`;
      console.warn(message);
      const { writeLog } = await import("@/lib/logging/service");
      await writeLog({ level: "warn", category: "maintenance", message }).catch(() => undefined);
    }
    const { kickWorker } = await import("@/lib/jobs/runner");
    kickWorker();
    const { startScheduler } = await import("@/lib/jobs/scheduler");
    startScheduler();
  }
}
