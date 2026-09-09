import { db } from "@/lib/db/client";
import { ensureBuiltInTemplates } from "@/lib/overlay/service";
import { PageHeader } from "@/components/page-header";
import { NewTemplateButton } from "@/components/new-template-button";
import { TemplateList } from "@/components/template-list";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await ensureBuiltInTemplates();
  const templates = await db.overlayTemplate.findMany({ orderBy: [{ isBuiltIn: "desc" }, { updatedAt: "desc" }] });
  return <>
    <PageHeader eyebrow="Overlay templates" title="Templates" action={<NewTemplateButton />} />
    <TemplateList templates={templates} />
  </>;
}
