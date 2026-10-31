// Native "choose a folder" dialogs for the launcher. Each returns the chosen absolute path, null when the
// operator cancelled, or undefined when no dialog is available here (no desktop session, or no supported
// dialog tool) -- launcher.mjs then asks for a typed path instead.
import { spawnSync } from "node:child_process";
import os from "node:os";

function run(program, args, input) {
  const result = spawnSync(program, args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  if (result.error) return { missing: true };
  return { status: result.status, output: result.stdout.trim() };
}

function macDialog(prompt) {
  const script = `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)} default location (path to home folder))`;
  const result = run("osascript", ["-e", script]);
  if (result.missing) return undefined;
  return result.status === 0 && result.output ? result.output : null;
}

function windowsDialog(prompt) {
  // The dialog gets a hidden TopMost owner window so it opens in front of the console that launched it.
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = '${prompt.replaceAll("'", "''")}'`,
    "$dialog.ShowNewFolderButton = $true",
    "$dialog.SelectedPath = [Environment]::GetFolderPath('UserProfile')",
    "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
  if (result.missing || result.status !== 0) return undefined;
  return result.output || null;
}

function linuxDialog(prompt) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return undefined;
  const candidates = [
    ["zenity", ["--file-selection", "--directory", `--title=${prompt}`, `--filename=${os.homedir()}/`]],
    ["kdialog", ["--getexistingdirectory", os.homedir(), "--title", prompt]]
  ];
  for (const [program, args] of candidates) {
    const result = run(program, args);
    if (result.missing) continue;
    return result.status === 0 && result.output ? result.output : null;
  }
  return undefined;
}

export function chooseFolderWithDialog(prompt, platform = process.platform) {
  if (platform === "darwin") return macDialog(prompt);
  if (platform === "win32") return windowsDialog(prompt);
  return linuxDialog(prompt);
}
