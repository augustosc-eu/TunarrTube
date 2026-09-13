import Link from "next/link";
import { LayoutTemplate } from "lucide-react";

type TemplateCardProps = { id: string; name: string; channelType: string; isBuiltIn: boolean; description: string | null };

export function TemplateCard(template: TemplateCardProps) {
  return (
    <Link href={`/templates/${template.id}`} className="card template-card">
      <div className="integration-heading" style={{ marginBottom: 10 }}>
        <LayoutTemplate size={18} />
      </div>
      <h3>{template.name}</h3>
      <p className="meta">{template.channelType.replace("_", " ")}{template.isBuiltIn ? " · built-in" : ""}</p>
      {template.description ? <p>{template.description}</p> : null}
    </Link>
  );
}
