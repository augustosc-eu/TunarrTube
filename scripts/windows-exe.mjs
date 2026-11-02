// Builds the portable Windows release's TunarrTube.exe (scripts/package-release.mjs): a Node.js single
// executable application of packaging/windows/sea-main.cjs, made from the release's own node.exe with
// TunarrTube's icon and name, and marked as a GUI program so it opens no console window.
//
// It works from any OS (resedit and postject are plain JavaScript), but the SEA blob has to come from an official
// Node.js build (distro and Homebrew builds may leave single executable applications out) of the same version
// as `nodeExe`: package-release.mjs, running on Windows, uses `nodeExe` itself.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

// Node.js looks for this fuse to tell a single executable application from a plain node.exe.
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;

// Icon and version info (what Explorer and Task Manager show), replacing Node.js's own. The copied
// Authenticode signature would no longer match, so it's dropped.
function brand(file, icon, version) {
  const exe = NtExecutable.from(readFileSync(file), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const icons = Data.IconFile.from(readFileSync(icon)).icons.map((item) => item.data);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  const [major = 0, minor = 0, patch = 0] = version.split("-")[0].split(".").map(Number);
  for (const info of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of info.getAllLanguagesForStringValues()) {
      info.setStringValues(language, {
        CompanyName: "TunarrTube",
        FileDescription: "TunarrTube",
        FileVersion: version,
        InternalName: "TunarrTube",
        LegalCopyright: "MIT License",
        OriginalFilename: "TunarrTube.exe",
        ProductName: "TunarrTube",
        ProductVersion: version
      });
    }
    info.setFileVersion(major, minor, patch, 0);
    info.setProductVersion(major, minor, patch, 0);
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}

// The PE optional header's Subsystem field: same offset in PE32 and PE32+.
export function markAsGuiProgram(file) {
  const data = readFileSync(file);
  const pe = data.readUInt32LE(0x3c);
  if (data.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error(`${file} isn't a Windows executable.`);
  data.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, pe + 24 + 68);
  writeFileSync(file, data);
}

export async function buildWindowsExe({ nodeExe, blobNode = nodeExe, output, icon, main, version, workDir }) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const blob = path.join(workDir, "sea-prep.blob");
  const config = path.join(workDir, "sea-config.json");
  writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  execFileSync(blobNode, ["--experimental-sea-config", config], { stdio: "inherit" });
  // Inject first: postject can't parse the executable resedit writes, while resedit keeps every resource,
  // the injected NODE_SEA_BLOB included.
  copyFileSync(nodeExe, output);
  const { inject } = createRequire(import.meta.url)("postject");
  await inject(output, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SEA_FUSE });
  writeFileSync(output, brand(output, icon, version));
  markAsGuiProgram(output);
  rmSync(workDir, { recursive: true, force: true });
}
