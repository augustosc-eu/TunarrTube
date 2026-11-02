import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

// Cross-platform stand-in for `which`, which Windows doesn't have. On Windows a bare name is looked up
// with an .exe/.com extension only: Node can't spawn a .cmd/.bat shim without a shell, so finding one
// would only turn "not found" into a confusing launch failure.
const WINDOWS_EXTENSIONS = [".exe", ".com"];

export async function isExecutableFile(candidate: string) {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(name: string, env: NodeJS.Dict<string> = process.env, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  // Windows environment keys are case-insensitive ("Path" is the usual spelling there).
  const searchPath = windows ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] : env.PATH;
  const names = windows && !pathApi.extname(name) ? WINDOWS_EXTENSIONS.map((extension) => `${name}${extension}`) : [name];
  for (const rawDirectory of (searchPath ?? "").split(pathApi.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, "$1");
    if (!directory) continue;
    for (const candidateName of names) {
      const candidate = pathApi.join(directory, candidateName);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}
