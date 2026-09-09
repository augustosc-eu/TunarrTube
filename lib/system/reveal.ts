import { spawn } from "node:child_process";
import path from "node:path";
import { AppError } from "@/lib/api";

// TunarrTube is a local-first, single-operator tool (docs/PRODUCT.md) run on the operator's own
// machine -- shelling out to the desktop's own "reveal in file manager" command sits squarely
// inside that trust boundary. Callers must only ever pass a path this app generated itself
// (RENDERS_ROOT-relative), never one built from raw user input.
export async function revealInFileManager(filePath: string): Promise<void> {
  const platform = process.platform;
  const [program, args] =
    platform === "darwin" ? ["open", ["-R", filePath]] :
    platform === "win32" ? ["explorer", [`/select,${filePath}`]] :
    ["xdg-open", [path.dirname(filePath)]];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: "ignore", detached: true });
    // "open"/"explorer"/"xdg-open" hand off to the desktop shell and don't reliably report success
    // via exit code (Explorer in particular can exit non-zero on a perfectly successful
    // "/select,"), so resolve as soon as the process launches rather than waiting on its exit.
    child.once("error", (error) => reject(new AppError("REVEAL_FAILED", `Could not open the file manager (${program}): ${error.message}`, 500)));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
