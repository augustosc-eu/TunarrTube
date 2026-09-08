import { AppError } from "@/lib/api";
import { anthropicProvider } from "@/lib/programming/providers/anthropic";
import { openaiProvider } from "@/lib/programming/providers/openai";
import type { AiProvider } from "@/lib/programming/providers/types";
import type { AiProviderName, AiProviderSetting } from "@/lib/programming/types";

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider
};

// Resolution order: an explicit Source/Channel override, else AppSettings.aiProvider (both are
// AiProviderSetting -- "auto" | "anthropic" | "openai"), else "auto". "auto" picks whichever of
// ANTHROPIC_API_KEY/OPENAI_API_KEY is present in the environment; both or neither present is an error
// rather than a silent default, since guessing wrong means an unexpected provider (and bill) runs.
export function resolveAiProvider(entityOverride: string | null | undefined, globalSetting: AiProviderSetting): AiProvider {
  const setting = (entityOverride as AiProviderSetting | null) ?? globalSetting;
  if (setting === "anthropic" || setting === "openai") return PROVIDERS[setting];
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
