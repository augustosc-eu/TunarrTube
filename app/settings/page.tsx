import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { getSettingsView } from "@/lib/settings/service";
import { inspectBinary } from "@/lib/system/binaries";
import { getClaudeCodeStatus } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, ytDlp, ffmpeg, claudeCode] = await Promise.all([getSettingsView(), inspectBinary("yt-dlp"), inspectBinary("ffmpeg"), getClaudeCodeStatus()]);
  return <><PageHeader eyebrow="Local configuration" title="Settings" /><SettingsForm initialDirectory={settings.mediaBaseDirectory} initialTunarrUrl={settings.tunarrUrl} initialCacheMegabytes={settings.cacheMaxMegabytes} initialCacheAgeDays={settings.cacheMaxAgeDays} initialLogRetentionDays={settings.logRetentionDays} initialDefaultVideoQuality={settings.defaultVideoQuality} initialMusicbrainzContactEmail={settings.musicbrainzContactEmail} initialMetadataMusicbrainzEnabled={settings.metadataMusicbrainzEnabled} initialMetadataItunesEnabled={settings.metadataItunesEnabled} initialMetadataAutoApplyThreshold={settings.metadataAutoApplyThreshold} initialAiProvider={settings.aiProvider} initialAiClaudeCodeEnabled={settings.aiClaudeCodeEnabled} initialAiClaudeCodePath={settings.aiClaudeCodePath} initialAiClaudeCodeTimeoutSeconds={settings.aiClaudeCodeTimeoutSeconds} initialYtdlpCookiesPath={settings.ytdlpCookiesPath} initialMappings={settings.pathMappings} initialDefaultNamingScheme={settings.defaultNamingScheme} initialDefaultFilenameTemplate={settings.defaultFilenameTemplate} ytDlp={ytDlp} ffmpeg={ffmpeg} claudeCode={claudeCode} /></>;
}
