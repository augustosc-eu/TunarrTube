// TunarrTube's own environment variables. Before the project was renamed, each was named YTARR_<suffix>;
// existing deployments may still set the old names, so they're honored as a fallback (the TUNARRTUBE_
// name always wins) and reported once at startup by warnLegacyEnvironment() so operators can rename them.
export const ENV_SUFFIXES = [
  "YTDLP_PATH",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
  "THUMBNAIL_DIR",
  "MEDIA_DIR",
  "TUNARR_URL",
  "YTDLP_COOKIES"
] as const;
export type EnvSuffix = (typeof ENV_SUFFIXES)[number];

const LEGACY_PREFIX = "YTARR_";

export function readEnv(suffix: EnvSuffix): string | undefined {
  return process.env[`TUNARRTUBE_${suffix}`] ?? process.env[`${LEGACY_PREFIX}${suffix}`];
}

// Legacy variables that are set, paired with the name to use instead. Only variables this app actually
// reads are listed, so a stray YTARR_ variable meant for something else isn't reported.
export function legacyEnvironmentInUse() {
  return ENV_SUFFIXES
    .filter((suffix) => process.env[`${LEGACY_PREFIX}${suffix}`] !== undefined)
    .map((suffix) => ({
      legacy: `${LEGACY_PREFIX}${suffix}`,
      current: `TUNARRTUBE_${suffix}`,
      // Both set: the new name already wins, so the old one is simply dead config.
      ignored: process.env[`TUNARRTUBE_${suffix}`] !== undefined
    }));
}
