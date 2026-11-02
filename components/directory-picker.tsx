"use client";

import { useState } from "react";
import { ArrowUp, Check, Folder, FolderOpen, FolderPlus, HardDrive, LoaderCircle } from "lucide-react";

type Listing = {
  path: string;
  parent: string | null;
  writable: boolean;
  freeBytes: number | null;
  totalBytes: number | null;
  directories: Array<{ name: string; path: string }>;
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

// A path text input with a "Browse" button that opens an in-page folder browser, backed by
// /api/system/directories. The server lists folders on *its* filesystem (inside the container under
// Docker), which is what the media directory has to be -- a native OS file dialog would show the
// browser machine's disks instead.
export function DirectoryPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");

  async function load(target?: string) {
    setLoading(true); setError(null);
    try {
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      setListing(await responseData(await fetch(`/api/system/directories${query}`)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't open that folder");
    } finally { setLoading(false); }
  }

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    // Start from whatever's typed if it's a real folder; fall back to the server's default.
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

  function choose() {
    if (!listing) return;
    onChange(listing.path);
    setOpen(false);
  }

  return <div className="directory-picker">
    <div className="directory-picker-input">
      <input className="input code" id={id} value={value} onChange={(event) => onChange(event.target.value)} />
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
          {listing.directories.length
            ? listing.directories.map((directory) => <li key={directory.path}><button type="button" onClick={() => load(directory.path)}><Folder size={15} /> {directory.name}</button></li>)
            : <li className="meta">No folders here.</li>}
        </ul>
        <div className="directory-footer">
          <span className="meta">
            {listing.writable ? <span className="success">Writable</span> : <span className="error-text">Not writable by TunarrTube</span>}
            {listing.freeBytes !== null && listing.totalBytes !== null && <span>{formatBytes(listing.freeBytes)} free of {formatBytes(listing.totalBytes)}</span>}
          </span>
          <div className="toolbar">
            <input className="input" placeholder="New folder name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createFolder(); } }} disabled={!listing.writable} />
            <button className="button secondary" type="button" onClick={createFolder} disabled={!listing.writable || !newFolder.trim() || loading}><FolderPlus size={15} /> Create</button>
            <span className="spacer" />
            <button className="button" type="button" onClick={choose} disabled={!listing.writable || loading}><Check size={15} /> Use this folder</button>
          </div>
        </div>
      </>}
    </div>}
  </div>;
}
