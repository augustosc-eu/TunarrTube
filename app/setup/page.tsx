import { PageHeader } from "@/components/page-header";
import { SetupWizard } from "@/components/setup-wizard";
import { getSettings } from "@/lib/settings/service";
import { inspectBinary } from "@/lib/system/binaries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup" };

export default async function SetupPage() {
  const [settings, ytDlp, ffmpeg] = await Promise.all([getSettings(), inspectBinary("yt-dlp"), inspectBinary("ffmpeg")]);
  return <><PageHeader eyebrow="First-run setup" title="Set up TunarrTube" /><SetupWizard initialDirectory={settings.mediaBaseDirectory} initialTunarrUrl={settings.tunarrUrl} ytDlp={ytDlp} ffmpeg={ffmpeg} rerun={settings.setupCompletedAt !== null} /></>;
}
