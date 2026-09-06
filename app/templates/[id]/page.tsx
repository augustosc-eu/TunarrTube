import { AppError } from "@/lib/api";
import { db } from "@/lib/db/client";
import { PageHeader } from "@/components/page-header";
import { TemplateEditor } from "@/components/template-editor";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = await db.overlayTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError("TEMPLATE_NOT_FOUND", "Overlay template not found.", 404);
  return <>
    <PageHeader eyebrow={template.channelType.replace("_", " ")} title={template.name} />
    <TemplateEditor template={template} />
  </>;
}
