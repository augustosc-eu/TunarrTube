import os from "node:os";
import path from "node:path";
import { access, mkdir, readdir, realpath, stat, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { AppError } from "@/lib/api";
import { DEFAULT_MEDIA_ROOT, STORAGE_ROOT } from "@/lib/constants";

// Backs the folder and file pickers in Settings and the setup wizard (components/directory-picker.tsx).
// It lists directory *names*, plus -- only when a file picker asks, via `files` -- the names of files of
// one kind (cookies .txt files, or executables). It never opens or reads a file, so a cookies file's
// contents can't leave the server through it. Dot-prefixed entries are hidden: they're config/cache
// entries, never a sensible media root.

export type StorageRoot = { label: string; path: string };
export type BrowseFileKind = "cookies" | "executable";

async function isDirectory(input: string) {
  return stat(input).then((stats) => stats.isDirectory(), () => false);
}

async function isWritable(input: string) {
  return access(input, constants.R_OK | constants.W_OK).then(() => true, () => false);
}

async function readVisibleEntries(input: string) {
  try {
    return (await readdir(input, { withFileTypes: true })).filter((entry) => !entry.name.startsWith("."));
  } catch {
    throw new AppError("DIRECTORY_UNREADABLE", "TunarrTube can't read that directory.", 400);
  }
}

async function readableChildDirectories(input: string) {
  return (await readVisibleEntries(input)).filter((entry) => entry.isDirectory()).map((entry) => path.join(input, entry.name));
}

// Whether `file` (a regular file, or a symlink to one) is the kind a file picker asked for. Cookies files
// are matched by their .txt extension only; executables by the execute bit (by extension on Windows,
// where spawn without a shell runs only .exe/.com -- see lib/system/find-executable.ts).
async function matchesFileKind(file: string, kind: BrowseFileKind) {
  if (!(await stat(file).then((stats) => stats.isFile(), () => false))) return false;
  if (kind === "cookies") return path.extname(file).toLowerCase() === ".txt";
  if (process.platform === "win32") return [".exe", ".com"].includes(path.extname(file).toLowerCase());
  return access(file, constants.X_OK).then(() => true, () => false);
}

async function childFiles(input: string, kind: BrowseFileKind) {
  const candidates = (await readVisibleEntries(input)).filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => path.join(input, entry.name));
  const matches = await Promise.all(candidates.map((file) => matchesFileKind(file, kind)));
  return candidates.filter((_, index) => matches[index]);
}

function byName(items: string[]) {
  return items.map((item) => ({ name: path.basename(item), path: item })).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }));
}

async function childDirectories(input: string) {
  return readableChildDirectories(input).catch(() => []);
}

// Free/total bytes of the filesystem holding `input`, or null where statfs isn't supported.
export async function diskSpace(input: string) {
  try {
    const stats = await statfs(input);
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

// Quick-access starting points: the current and default media directories, the home directory, and
// wherever this OS mounts external drives (macOS /Volumes, Linux /mnt and /media, Windows drive letters).
export async function listStorageRoots(currentMediaDirectory?: string | null): Promise<StorageRoot[]> {
  const candidates: StorageRoot[] = [];
  if (currentMediaDirectory) candidates.push({ label: "Current media directory", path: currentMediaDirectory });
  candidates.push({ label: "TunarrTube storage", path: STORAGE_ROOT }, { label: "Default media directory", path: DEFAULT_MEDIA_ROOT }, { label: "Home", path: os.homedir() });
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") candidates.push({ label: `${letter}:`, path: `${letter}:\\` });
  } else {
    if (process.platform === "darwin") {
      for (const volume of await childDirectories("/Volumes")) candidates.push({ label: path.basename(volume), path: volume });
    } else {
      const user = os.userInfo().username;
      for (const mount of [...await childDirectories("/mnt"), ...await childDirectories("/media"), ...await childDirectories(path.join("/media", user)), ...await childDirectories(path.join("/run/media", user))]) {
        candidates.push({ label: path.basename(mount), path: mount });
      }
    }
    candidates.push({ label: "Filesystem root", path: "/" });
  }
  const seen = new Set<string>();
  const roots: StorageRoot[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path) || !(await isDirectory(candidate.path))) continue;
    seen.add(candidate.path);
    roots.push(candidate);
  }
  return roots;
}

// With `files`, also lists that kind of file, and a file path opens its containing folder (so a file
// picker can start from the file already entered).
export async function browseDirectory(input: string, currentMediaDirectory?: string | null, files?: BrowseFileKind) {
  if (!path.isAbsolute(input)) throw new AppError("INVALID_DIRECTORY", "Directory path must be absolute.");
  let resolved: string;
  try {
    resolved = await realpath(input);
  } catch {
    throw new AppError("DIRECTORY_NOT_FOUND", "That directory doesn't exist.", 404);
  }
  if (!(await isDirectory(resolved))) {
    if (!files) throw new AppError("NOT_A_DIRECTORY", "That path isn't a directory.", 400);
    resolved = path.dirname(resolved);
  }
  const [directories, fileEntries] = await Promise.all([readableChildDirectories(resolved), files ? childFiles(resolved, files) : Promise.resolve(null)]);
  const parent = path.dirname(resolved);
  const [writable, space, roots] = await Promise.all([isWritable(resolved), diskSpace(resolved), listStorageRoots(currentMediaDirectory)]);
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    writable,
    freeBytes: space?.freeBytes ?? null,
    totalBytes: space?.totalBytes ?? null,
    directories: byName(directories),
    ...(fileEntries ? { files: byName(fileEntries) } : {}),
    roots
  };
}

// Creates one new folder directly inside `parent` (the "New folder" button in the picker). `name` is a
// single path segment -- separators and "."/".." are rejected so it can't escape the parent.
export async function createDirectory(parent: string, name: string) {
  if (!path.isAbsolute(parent)) throw new AppError("INVALID_DIRECTORY", "Directory path must be absolute.");
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new AppError("INVALID_DIRECTORY_NAME", "Folder name can't be empty or contain slashes.");
  }
  if (!(await isWritable(parent))) throw new AppError("DIRECTORY_NOT_WRITABLE", "TunarrTube can't create folders there.", 400);
  const target = path.join(await realpath(parent), trimmed);
  await mkdir(target, { recursive: true });
  return { path: target };
}
