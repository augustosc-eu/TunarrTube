"use client";

import { useState } from "react";
import { ChannelForm } from "@/components/channel-form";
import { ChannelBriefForm } from "@/components/channel-brief-form";

type Template = { id: string; name: string; channelType: string; isBuiltIn: boolean };
type SourceOption = { id: string; name: string };

export function ChannelCreateTabs({ templates, sources }: { templates: Template[]; sources: SourceOption[] }) {
  const [tab, setTab] = useState<"manual" | "brief">("manual");
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button className={tab === "manual" ? "button" : "button secondary"} type="button" onClick={() => setTab("manual")}>Create manually</button>
        <button className={tab === "brief" ? "button" : "button secondary"} type="button" onClick={() => setTab("brief")}>Create from a brief</button>
      </div>
      {tab === "manual" ? <ChannelForm templates={templates} /> : <ChannelBriefForm templates={templates} sources={sources} />}
    </>
  );
}
