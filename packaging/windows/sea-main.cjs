// TunarrTube.exe (Windows): a Node.js single executable application that scripts/package-release.mjs builds
// from this file, the release's own node.exe and TunarrTube.ico, marked as a GUI program so double-clicking
// it opens no console window. It starts the launcher with the bundled runtime\node.exe; there's no terminal,
// so the launcher asks with dialogs, the web UI's Quit button stops it, and all output goes to
// %LOCALAPPDATA%\TunarrTube\Logs\launcher.log. TunarrTube.cmd starts the same launcher in a console.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.dirname(process.execPath);
const logDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "TunarrTube", "Logs");
const log = path.join(logDir, "launcher.log");
fs.mkdirSync(logDir, { recursive: true });
// Keep one previous log once this one passes 5 MB.
try {
  if (fs.statSync(log).size > 5_000_000) fs.renameSync(log, `${log}.1`);
} catch {
  // no log yet
}
const output = fs.openSync(log, "a");
fs.writeSync(output, `\n=== ${new Date().toISOString()} TunarrTube.exe starting\n`);

// windowsHide gives the launcher a console without a window, which the server, yt-dlp and FFmpeg inherit --
// without one, Windows would open a console window for each of them. In a single executable application
// process.argv[1] is the executable again, so the operator's arguments start at [2].
const launcher = spawn(path.join(root, "runtime", "node.exe"), [path.join(root, "launcher", "launcher.mjs"), ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, TUNARRTUBE_APP: "1", TUNARRTUBE_LOG_FILE: log },
  stdio: ["ignore", output, output],
  windowsHide: true
});
launcher.on("error", (error) => {
  fs.writeSync(output, `Could not start ${launcher.spawnfile}: ${error.message}\n`);
  process.exit(1);
});
launcher.on("exit", (code) => process.exit(code ?? 1));
