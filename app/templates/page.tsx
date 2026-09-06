import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { db } from "@/lib/db/client";
import { ensureBuiltInTemplates } from "@/lib/overlay/service";
import { PageHeader } from "@/components/page-header";
import { NewTemplateButton } from "@/components/new-template-button";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await ensureBuiltInTemplates();
  const templates = await db.overlayTemplate.findMany({ orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }] });
  return <>
    <PageHeader eyebrow="Overlay templates" title="Templates" action={<NewTemplateButton />} />
    <div className="grid">
      {templates.map((template) => (
        <Link key={template.id} href={`/templates/${template.id}`} className="card">
          <div className="integration-heading" style={{ marginBottom: 10 }}>
            <LayoutTemplate size={18} />
          </div>
          <h3>{template.name}</h3>
          <p className="meta">{template.channelType.replace("_", " ")}{template.isBuiltIn ? " · built-in" : ""}</p>
          {template.description ? <p>{template.description}</p> : null}
        </Link>
      ))}
    </div>
  </>;
}
