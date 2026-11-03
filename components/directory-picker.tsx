"use client";

import { useState } from "react";
import { ArrowUp, Check, File, Folder, FolderOpen, FolderPlus, HardDrive, LoaderCircle } from "lucide-react";

type Listing = {
  path: string;
  parent: string | null;
  writable: boolean;
  freeBytes: number | null;
  totalBytes: number | null;
  directories: Array<{ name: string; path: string }>;
  files?: Array<{ name: string; path: string }>;
  roots: Array<{ label: string; path: string }>;
};

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function responseData(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body.data;
}

type FileKind = "cookies" | "executable";
type PickerProps = { id: string; value: string; onChange: (value: string) => void; placeholder?: string };

// A path text input with a "Browse" button that opens an in-page browser, backed by
// /api/system/directories. The server lists folders (and, for a file picker, file names) on *its*
// filesystem (inside the container under Docker), which is where these paths have to resolve -- a native
// OS file dialog would show the browser machine's disks instead.
//
// DirectoryPicker picks a folder. With `requireWritable` (the default, for the media directory) only a
// writable folder can be chosen and new folders can be created; without it (e.g. a path-mapping prefix)
// any readable folder can be chosen.
export function DirectoryPicker({ requireWritable = true, ...props }: PickerProps & { requireWritable?: boolean }) {
  return <PathPicker {...props} requireWritable={requireWritable} />;
}

// FilePicker picks one file of `kind`: cookies .txt files or executables. Clicking a file chooses it.
export function FilePicker({ kind, ...props }: PickerProps & { kind: FileKind }) {
  return <PathPicker {...props} fileKind={kind} requireWritable={false} />;
}

function PathPicker({ id, value, onChange, placeholder, fileKind, requireWritable }: PickerProps & { fileKind?: FileKind; requireWritable: boolean }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");

  async function load(target?: string) {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (target) params.set("path", target);
      if (fileKind) params.set("files", fileKind);
      const query = params.toString() ? `?${params}` : "";
      setListing(await responseData(await fetch(`/api/system/directories${query}`)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't open that folder");
    } finally { setLoading(false); }
  }

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    // Start from whatever's typed if it's a real folder (or, for a file picker, file); fall back to the
    // server's default.
    await load(value.trim() || undefined).catch(() => undefined);
  }

  async function createFolder() {
    if (!listing || !newFolder.trim()) return;
    setLoading(true); setError(null);
    try {
      const created = await responseData(await fetch("/api/system/directories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent: listing.path, name: newFolder }) }));
      setNewFolder("");
      await load(created.path);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create folder");
      setLoading(false);
    }
  }

  function choose(target: string) {
    onChange(target);
    setOpen(false);
  }

  return <div className="directory-picker">
    <div className="directory-picker-input">
      <input className="input code" id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <button className="button secondary" type="button" onClick={toggle} aria-expanded={open}><FolderOpen size={15} /> {open ? "Close" : "Browse"}</button>
    </div>
    {open && <div className="directory-browser">
      {listing && <div className="directory-roots">{listing.roots.map((root) => <button key={root.path} type="button" className={`directory-root${root.path === listing.path ? " active" : ""}`} onClick={() => load(root.path)} title={root.path}><HardDrive size={13} /> {root.label}</button>)}</div>}
      {error && <div className="error">{error}{!listing && <> <button className="button secondary" type="button" onClick={() => load()}>Open default folder</button></>}</div>}
      {listing && <>
        <div className="directory-current">
          <button className="button secondary" type="button" disabled={!listing.parent || loading} onClick={() => listing.parent && load(listing.parent)} title="Parent folder"><ArrowUp size={15} /></button>
          <span className="code">{listing.path}</span>
          {loading && <LoaderCircle size={15} className="animate-spin" />}
        </div>
        <ul className="directory-list">
          {listing.directories.map((directory) => <li key={directory.path}><button type="button" onClick={() => load(directory.path)}><Folder size={15} /> {directory.name}</button></li>)}
          {listing.files?.map((file) => <li key={file.path}><button type="button" className={file.path === value ? "active" : undefined} onClick={() => choose(file.path)}><File size={15} /> {file.name}</button></li>)}
          {!listing.directories.length && !listing.files?.length && <li className="meta">{fileKind ? `No folders or ${fileKind === "cookies" ? ".txt files" : "executables"} here.` : "No folders here."}</li>}
        </ul>
        {fileKind
          ? <div className="directory-footer"><span className="meta">{fileKind === "cookies" ? "Showing folders and .txt files. Click a file to use it." : "Showing folders and executable files. Click a file to use it."}</span></div>
          : <div className="directory-footer">
            <span className="meta">
              {listing.writable ? <span className="success">Writable</span> : <span className={requireWritable ? "error-text" : undefined}>Not writable by TunarrTube</span>}
              {listing.freeBytes !== null && listing.totalBytes !== null && <span>{formatBytes(listing.freeBytes)} free of {formatBytes(listing.totalBytes)}</span>}
            </span>
            <div className="toolbar">
              {requireWritable && <>
                <input className="input" placeholder="New folder name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createFolder(); } }} disabled={!listing.writable} />
                <button className="button secondary" type="button" onClick={createFolder} disabled={!listing.writable || !newFolder.trim() || loading}><FolderPlus size={15} /> Create</button>
              </>}
              <span className="spacer" />
              <button className="button" type="button" onClick={() => choose(listing.path)} disabled={(requireWritable && !listing.writable) || loading}><Check size={15} /> Use this folder</button>
            </div>
          </div>}
      </>}
    </div>}
  </div>;
}
