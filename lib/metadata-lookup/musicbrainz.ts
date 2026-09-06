import { AppError } from "@/lib/api";
import { getSettings } from "@/lib/settings/service";
import type { MetadataCandidate, MetadataProvider } from "@/lib/metadata-lookup/types";

const MIN_INTERVAL_MS = 1100; // MusicBrainz's usage policy asks for ~1 request/second per client.
let lastRequestAt = 0;

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

type MbRecording = {
  id: string;
  title: string;
  score?: number;
  "artist-credit"?: Array<{ name: string }>;
  releases?: Array<{ id: string; title?: string; date?: string }>;
};

function luceneEscape(value: string) {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

export const musicBrainzProvider: MetadataProvider = {
  async search({ title, artist }, signal) {
    const settings = await getSettings();
    const contact = settings.musicbrainzContactEmail || "no-contact-configured@example.com";
    const clauses = [`recording:"${luceneEscape(title)}"`];
    if (artist) clauses.push(`artist:"${luceneEscape(artist)}"`);
    const query = new URLSearchParams({ query: clauses.join(" AND "), fmt: "json", limit: "10" });

    await throttle();
    let response: Response;
    try {
      response = await fetch(`https://musicbrainz.org/ws/2/recording/?${query.toString()}`, {
        signal,
        headers: { "User-Agent": `tunarrtube/0.1 ( ${contact} )`, Accept: "application/json" }
      });
    } catch (error) {
      throw new AppError("MUSICBRAINZ_UNREACHABLE", `Could not reach MusicBrainz: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    if (!response.ok) throw new AppError("MUSICBRAINZ_API_ERROR", `MusicBrainz returned ${response.status}.`, 502);
    const body = (await response.json()) as { recordings?: MbRecording[] };

    return (body.recordings ?? []).map((recording): MetadataCandidate => {
      const release = recording.releases?.[0];
      const year = release?.date ? Number(release.date.slice(0, 4)) : undefined;
      return {
        provider: "musicbrainz",
        externalId: recording.id,
        title: recording.title,
        artist: recording["artist-credit"]?.map((credit) => credit.name).join(", "),
        album: release?.title,
        year: Number.isFinite(year) ? year : undefined,
        releaseDate: release?.date,
        artUrl: release ? `https://coverartarchive.org/release/${release.id}/front-250` : null,
        score: recording.score ?? 0
      };
    });
  }
};
