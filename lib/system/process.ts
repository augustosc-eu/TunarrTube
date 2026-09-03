import { spawn } from "node:child_process";
import { AppError } from "@/lib/api";
import { sanitizeLogValue } from "@/lib/logging/service";

type RunOptions = {
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type ProcessResult = { stdout: string; stderr: string; code: number };

export function safeCommand(program: string, args: string[]) {
  return [program, ...args].map((arg) => sanitizeLogValue(arg)).join(" ");
}

export async function runProcess(program: string, args: string[], options: RunOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxOutput = 25 * 1024 * 1024;

    const finish = (error?: Error, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => child.kill("SIGTERM");
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish(new AppError("PROCESS_TIMEOUT", `${program} timed out.`, 504));
        }, options.timeoutMs)
      : undefined;

    if (options.signal?.aborted) abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length <= maxOutput) stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= maxOutput) stderr += chunk;
      options.onStderr?.(chunk);
    });
    child.on("error", (error) => finish(new AppError("PROCESS_START_FAILED", `Could not start ${program}: ${error.message}`, 500)));
    child.on("close", (code, signal) => {
      if (options.signal?.aborted) {
        finish(new AppError("PROCESS_CANCELLED", `${program} was cancelled.`, 499));
        return;
      }
      const result = { stdout, stderr, code: code ?? -1 };
      if (code !== 0) {
        finish(new AppError("PROCESS_FAILED", `${program} failed${signal ? ` (${signal})` : ""}: ${sanitizeLogValue(stderr.trim()).slice(-1200)}`, 502));
        return;
      }
      finish(undefined, result);
    });
  });
}
