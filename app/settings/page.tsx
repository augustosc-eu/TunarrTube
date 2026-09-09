import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { getSettingsView } from "@/lib/settings/service";
import { inspectBinary } from "@/lib/system/binaries";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, ytDlp, ffmpeg] = await Promise.all([getSettingsView(), inspectBinary("yt-dlp"), inspectBinary("ffmpeg")]);
  return <><PageHeader eyebrow="Local configuration" title="Settings" /><SettingsForm initialDirectory={settings.mediaBaseDirectory} initialTunarrUrl={settings.tunarrUrl} initialCacheMegabytes={settings.cacheMaxMegabytes} initialCacheAgeDays={settings.cacheMaxAgeDays} initialLogRetentionDays={settings.logRetentionDays} initialDefaultVideoQuality={settings.defaultVideoQuality} initialYtdlpCookiesPath={settings.ytdlpCookiesPath} initialMappings={settings.pathMappings} initialDefaultNamingScheme={settings.defaultNamingScheme} initialDefaultFilenameTemplate={settings.defaultFilenameTemplate} ytDlp={ytDlp} ffmpeg={ffmpeg} /></>;
}
