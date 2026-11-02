import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

import { quitAvailable, requestQuit } from "@/lib/system/quit";

const platform = process.platform;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  spawn.mockReset();
  Object.defineProperty(process, "platform", { value: platform });
});

describe("quit from the web UI", () => {
  it("is only available when a desktop app started TunarrTube", async () => {
    vi.stubEnv("TUNARRTUBE_QUIT_ENABLED", "");
    expect(quitAvailable()).toBe(false);
    await expect(requestQuit()).rejects.toMatchObject({ code: "QUIT_UNAVAILABLE", status: 409 });
  });

  it("signals the server's whole process group after responding", async () => {
    vi.stubEnv("TUNARRTUBE_QUIT_ENABLED", "1");
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

    expect(await requestQuit()).toEqual({ quitting: true });
    expect(kill).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(kill).toHaveBeenCalledWith(-process.pid, "SIGTERM");
  });

  it("falls back to signalling only itself when it doesn't lead a process group", async () => {
    vi.stubEnv("TUNARRTUBE_QUIT_ENABLED", "1");
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === -process.pid) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      return true;
    });

    await requestQuit();
    await vi.runAllTimersAsync();
    expect(kill).toHaveBeenLastCalledWith(process.pid, "SIGTERM");
  });

  it("ends its own process tree on Windows, which has no process groups", async () => {
    vi.stubEnv("TUNARRTUBE_QUIT_ENABLED", "1");
    vi.useFakeTimers();
    Object.defineProperty(process, "platform", { value: "win32" });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    spawn.mockReturnValue(new EventEmitter());

    await requestQuit();
    await vi.runAllTimersAsync();
    expect(spawn).toHaveBeenCalledWith("taskkill", ["/pid", String(process.pid), "/T", "/F"], expect.objectContaining({ windowsHide: true }));
    expect(kill).not.toHaveBeenCalled();
  });
});
