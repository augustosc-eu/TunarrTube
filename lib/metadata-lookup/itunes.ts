import { AppError } from "@/lib/api";
import { fetchJsonWithRetry, similarityScore, withProviderCache } from "@/lib/metadata-lookup/http";
import type { MetadataCandidate, MetadataProvider } from "@/lib/metadata-lookup/types";

type ItunesResult = {
  trackId: number;
  trackName: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
};

// entity=musicVideo matters here: MusicBrainz's data is centered on audio recordings and can miss
// music-video-specific releases that iTunes' catalog has.
export const itunesProvider: MetadataProvider = {
  async search({ title, artist }, signal) {
    const term = artist ? `${artist} ${title}` : title;
    const query = new URLSearchParams({ term, media: "musicVideo", entity: "musicVideo", limit: "10" });
    const url = `https://itunes.apple.com/search?${query.toString()}`;

    const body = await withProviderCache(`itunes:${url}`, async () => {
      let response: Response;
      try {
        response = await fetchJsonWithRetry(url, {}, signal);
      } catch (error) {
        throw new AppError("ITUNES_UNREACHABLE", `Could not reach the iTunes Search API: ${error instanceof Error ? error.message : String(error)}`, 502);
      }
      if (!response.ok) throw new AppError("ITUNES_API_ERROR", `iTunes Search API returned ${response.status}.`, 502);
      return (await response.json()) as { results?: ItunesResult[] };
    });

    // The API itself returns results in relevance order but no comparable score, so approximate one
    // by comparing the query term against each result's own "artist title" text -- this is what puts
    // iTunes candidates on the same 0-100 scale as MusicBrainz's native score for
    // lib/metadata-lookup/service.ts:autoApplyMetadata's auto-apply threshold.
    return (body.results ?? []).map((result): MetadataCandidate => ({
      provider: "itunes",
      externalId: String(result.trackId),
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName,
      year: result.releaseDate ? Number(result.releaseDate.slice(0, 4)) : undefined,
      releaseDate: result.releaseDate?.slice(0, 10),
      artUrl: result.artworkUrl100 ? result.artworkUrl100.replace("100x100", "600x600") : null,
      score: similarityScore(term, `${result.artistName ?? ""} ${result.trackName}`)
    }));
  }
};
