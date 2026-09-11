import { AppError } from "@/lib/api";
import { anthropicProvider } from "@/lib/programming/providers/anthropic";
import { openaiProvider } from "@/lib/programming/providers/openai";
import { claudeCodeProvider } from "@/lib/programming/providers/claude-code";
import type { AiProvider } from "@/lib/programming/providers/types";
import type { AiProviderName, AiProviderSetting } from "@/lib/programming/types";

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  "claude-code": claudeCodeProvider
};

// Resolution order: an explicit Source/Channel override, else AppSettings.aiProvider (both are
// AiProviderSetting -- "auto" | "anthropic" | "openai" | "claude-code"), else "auto". "auto" picks
// whichever of ANTHROPIC_API_KEY/OPENAI_API_KEY is present in the environment; both or neither present
// is an error rather than a silent default, since guessing wrong means an unexpected provider (and
// bill) runs. "claude-code" deliberately never participates in "auto": unlike the two API-key
// providers, whether it's usable can only be known by asking the local OS to spawn a process (no env
// var to check synchronously), and this app's is designed to add zero behavior change when Claude Code
// isn't configured -- an install with neither API key set today gets the same
// AI_PROVIDER_UNCONFIGURED error it always has, not a surprise new default. Using Claude Code requires
// explicitly selecting it (AppSettings.aiProvider or a Source/Channel override).
export function resolveAiProvider(entityOverride: string | null | undefined, globalSetting: AiProviderSetting): AiProvider {
  const setting = (entityOverride as AiProviderSetting | null) ?? globalSetting;
  if (setting === "anthropic" || setting === "openai" || setting === "claude-code") return PROVIDERS[setting];
  if (setting !== "auto") {
    throw new AppError("AI_PROVIDER_INVALID", `Unknown AI provider "${setting}".`, 422);
  }
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  if (hasAnthropic && hasOpenAi) {
    throw new AppError("AI_PROVIDER_AMBIGUOUS", "Both ANTHROPIC_API_KEY and OPENAI_API_KEY are set. Choose a provider explicitly in Settings (or per-channel/source) instead of relying on auto-detection.", 422);
  }
  if (hasAnthropic) return PROVIDERS.anthropic;
  if (hasOpenAi) return PROVIDERS.openai;
  throw new AppError("AI_PROVIDER_UNCONFIGURED", "No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.", 422);
}
