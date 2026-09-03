export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { kickWorker } = await import("@/lib/jobs/runner");
    kickWorker();
    const { startScheduler } = await import("@/lib/jobs/scheduler");
    startScheduler();
  }
}
