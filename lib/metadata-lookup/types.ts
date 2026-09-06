export type MetadataCandidate = {
  provider: "musicbrainz" | "itunes";
  externalId: string;
  title: string;
  artist?: string;
  album?: string;
  year?: number;
  releaseDate?: string; // YYYY-MM-DD
  artUrl?: string | null;
  score: number;
};

export interface MetadataProvider {
  search(query: { title: string; artist?: string }, signal?: AbortSignal): Promise<MetadataCandidate[]>;
}
