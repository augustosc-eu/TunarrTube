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

// The desktop apps (TunarrTube.app, TunarrTube.exe, the AppImage) have no terminal: these stand in for the
// launcher's typed menus and its error output there. showButtons returns the clicked button's label, null
// when the dialog was dismissed, or undefined when there's no dialog tool here (a Linux desktop without
// zenity or kdialog). Buttons are listed left to right; the last one is the default.
function appleScriptString(value) {
  return JSON.stringify(String(value));
}

function powershellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function powershell(lines) {
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", ["[Console]::OutputEncoding = [System.Text.Encoding]::UTF8", "Add-Type -AssemblyName System.Windows.Forms", ...lines].join("; ")]);
  return result.missing ? undefined : result;
}

function macButtons(message, buttons) {
  const script = `button returned of (display dialog ${appleScriptString(message)} with title "TunarrTube" buttons {${buttons.map(appleScriptString).join(", ")}} default button ${appleScriptString(buttons.at(-1))} with icon note)`;
  const result = run("osascript", ["-e", script]);
  if (result.missing) return undefined;
  return result.status === 0 && result.output ? result.output : null;
}

// A small WinForms dialog: MessageBox can't label its buttons.
function windowsButtons(message, buttons) {
  const result = powershell([
    "$form = New-Object System.Windows.Forms.Form -Property @{ Text = 'TunarrTube'; TopMost = $true; StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; MinimizeBox = $false; AutoSize = $true; AutoSizeMode = 'GrowAndShrink'; Padding = 12 }",
    "$layout = New-Object System.Windows.Forms.FlowLayoutPanel -Property @{ FlowDirection = 'TopDown'; AutoSize = $true }",
    `$layout.Controls.Add((New-Object System.Windows.Forms.Label -Property @{ Text = ${powershellString(message)}; AutoSize = $true; MaximumSize = New-Object System.Drawing.Size(460, 0); Margin = '0,0,0,12' }))`,
    "$row = New-Object System.Windows.Forms.FlowLayoutPanel -Property @{ AutoSize = $true }",
    ...buttons.map((label) => `$button = New-Object System.Windows.Forms.Button -Property @{ Text = ${powershellString(label.replaceAll("&", "&&"))}; AutoSize = $true; Tag = ${powershellString(label)} }; $button.Add_Click({ $form.Tag = $this.Tag; $form.Close() }); $row.Controls.Add($button)`),
    "$form.AcceptButton = $button",
    "$layout.Controls.Add($row); $form.Controls.Add($layout)",
    "[void]$form.ShowDialog(); if ($form.Tag) { $form.Tag }"
  ]);
  if (!result || result.status !== 0) return undefined;
  return result.output || null;
}

function linuxButtons(message, buttons) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return undefined;
  // zenity --switch drops its own OK/Cancel and prints the clicked extra button's label.
  const zenity = run("zenity", ["--question", "--switch", "--title=TunarrTube", `--text=${message}`, "--no-markup", ...buttons.flatMap((label) => ["--extra-button", label])]);
  // 0/1 is a click or a dismissed dialog; anything else is an error, e.g. a zenity too old for --switch.
  if (!zenity.missing && (zenity.status === 0 || zenity.status === 1)) return zenity.output || null;
  if (buttons.length > 3) return undefined;
  // kdialog: yes / no / cancel, exiting 0 / 1 / 2.
  const labels = buttons.length === 3 ? [buttons[2], buttons[1], buttons[0]] : buttons.length === 2 ? [buttons[1], buttons[0]] : [buttons[0]];
  const kind = buttons.length === 3 ? "--yesnocancel" : buttons.length === 2 ? "--yesno" : "--msgbox";
  const kdialog = run("kdialog", ["--title", "TunarrTube", kind, message, "--yes-label", labels[0], ...(labels[1] ? ["--no-label", labels[1]] : []), ...(labels[2] ? ["--cancel-label", labels[2]] : [])]);
  if (kdialog.missing) return undefined;
  return labels[kdialog.status] ?? null;
}

export function showButtons(message, buttons, platform = process.platform) {
  if (platform === "darwin") return macButtons(message, buttons);
  if (platform === "win32") return windowsButtons(message, buttons);
  return linuxButtons(message, buttons);
}

export function showAlert(title, message, platform = process.platform) {
  if (platform === "darwin") return void run("osascript", ["-e", `display alert ${appleScriptString(title)} message ${appleScriptString(message)} as critical`]);
  if (platform === "win32") return void powershell([`[void][System.Windows.Forms.MessageBox]::Show(${powershellString(message)}, ${powershellString(title)}, 'OK', 'Error')`]);
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  if (!run("zenity", ["--error", `--title=${title}`, `--text=${message}`, "--no-markup"]).missing) return;
  run("kdialog", ["--title", title, "--error", message]);
}
