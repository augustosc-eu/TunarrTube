// YouTube video titles carry a lot of text that has nothing to do with the recording itself --
// "(Official Music Video)", "[Lyric Video]", "MV", "(Behind The Scenes)", "(Test)" -- and often
// follow the "Artist - Title" convention (already assumed by the comment on similarityScore in
// lib/metadata-lookup/http.ts). autoApplyMetadata (lib/metadata-lookup/service.ts) used to hand
// providers the raw title verbatim: every noise word became an extra query/scoring token that
// diluted similarityScore's overlap ratio and an artist that was sitting right there in the title
// never got passed to MusicBrainz's `artist:"..."` clause or iTunes' search term. Both starved
// otherwise-easy matches below the auto-apply threshold. This cleans the title before it reaches
// either provider; a title with no recognizable "Artist - Title" shape is returned unsplit, same
// as before this existed.

// Only words -- never a bare "official"/"video" substring match -- so a legitimate title word that
// happens to contain one (e.g. "Videodrome") isn't treated as noise.
const NOISE_WORDS = new Set([
  "official", "music", "video", "audio", "lyric", "lyrics", "live", "visualizer", "behind", "the",
  "scenes", "test", "hd", "uhd", "4k", "mv", "m/v", "clean", "explicit", "version", "performance"
]);

function isNoiseAnnotation(content: string): boolean {
  const words = content.toLowerCase().split(/[\s/-]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => NOISE_WORDS.has(word));
}

const BRACKET_PAIRS: Array<[string, string]> = [
  ["(", ")"], ["[", "]"],
  ["（", "）"], ["［", "］"] // full-width variants, common in Japanese/Korean/Chinese titles
];

// Only the outermost trailing pair, not the innermost -- so "(Instrumental - Official Audio)"
// (a real annotation, but not *only* noise words) is inspected as a whole rather than peeling off
// "Official Audio)" and leaving a dangling "(Instrumental -" behind.
function stripTrailingBracket(text: string): { content: string; rest: string } | null {
  for (const [open, close] of BRACKET_PAIRS) {
    if (!text.endsWith(close)) continue;
    const openIndex = text.lastIndexOf(open);
    if (openIndex < 0) continue;
    return { content: text.slice(openIndex + 1, text.length - close.length), rest: text.slice(0, openIndex).trimEnd() };
  }
  return null;
}

function stripNoiseAnnotations(rawTitle: string): string {
  let result = rawTitle.trim();
  for (;;) {
    const stripped = stripTrailingBracket(result);
    if (!stripped || !isNoiseAnnotation(stripped.content)) break;
    result = stripped.rest;
  }
  // YouTube also appends a bare "MV" outside any brackets on plenty of Japanese/Korean uploads.
  return result.replace(/\s+m\/?v$/i, "").trim();
}

export type ParsedMusicTitle = { title: string; artist?: string };

// Splits the "Artist - Title" convention (also en/em dash) after stripping noise annotations.
// Falls back to the cleaned (but unsplit) title when the pattern isn't present.
export function parseMusicTitle(rawTitle: string): ParsedMusicTitle {
  const cleaned = stripNoiseAnnotations(rawTitle);
  const dashSplit = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (!dashSplit) return { title: cleaned };
  const [, artist, title] = dashSplit;
  const unquotedTitle = title.replace(/^['"‘’“”]+|['"‘’“”]+$/gu, "").trim();
  // A degenerate right-hand side (e.g. the "title" was nothing but quote marks) means this wasn't
  // really an "Artist - Title" split -- fall back to the whole cleaned string, unsplit.
  if (!unquotedTitle) return { title: cleaned };
  return { artist: artist.trim(), title: unquotedTitle };
}
