// Framework-agnostic on purpose (no fs/path/node imports) so this single implementation drives
// both the server-side Puppeteer render (lib/overlay/service.ts) and the client-side live preview
// (a sandboxed <iframe srcDoc> in components/template-preview-frame.tsx).

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fillTemplate(html: string, data: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(data, key) ? escapeHtml(data[key]) : ""
  );
}
