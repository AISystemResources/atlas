/**
 * LLM client factory — provider-agnostic.
 *
 * Supported providers:
 *   groq             — ChatGroq (DEFAULT — fast inference, low cost, no API-key cost ceiling)
 *   ollama           — ChatOllama (local, no API key)
 *   openai-compatible — ChatOpenAI with a custom baseURL
 *   gemini           — DEPRECATED; kept for backward compat with old backtest records.
 *                      Per 2026-06-17 architectural decision, Atlas does not use any
 *                      paid LLM APIs (Gemini / GPT / Claude) — only Groq server-side
 *                      and MCP for user-driven inference.
 *
 * getLlm("quick") with no second arg now returns the Groq fast model (Llama 3.1 8B).
 * Provider packages are lazy-loaded so cold-start cost is paid only on use.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ─── Public types ──────────────────────────────────────────────────────────────

export type LLMProvider = "gemini" | "groq" | "ollama" | "openai-compatible";

export type LlmMode = "quick" | "deep";

export type LLMConfig = {
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  /** Groq / OpenAI-compatible API key.  Ollama has none. */
  apiKey?: string;
};

// ─── Groq model catalogue ──────────────────────────────────────────────────────
// Models available on Groq's free tier as of 2026-04.
// "fast"     = smaller, lower latency, lower cost   → use for quick analyst rounds
// "balanced" = larger, more capable                 → use for synthesis / deep rounds

export const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile",  label: "Llama 3.3 70B",        tier: "balanced" },
  { id: "llama-3.1-8b-instant",     label: "Llama 3.1 8B (fast)",   tier: "fast"     },
  { id: "gemma2-9b-it",             label: "Gemma 2 9B",            tier: "fast"     },
  { id: "mixtral-8x7b-32768",       label: "Mixtral 8×7B",          tier: "balanced" },
  { id: "llama3-70b-8192",          label: "Llama 3 70B",           tier: "balanced" },
] as const;

export type GroqModelId = (typeof GROQ_MODELS)[number]["id"];

// ─── Default models per provider × tier ───────────────────────────────────────

export const PROVIDER_DEFAULTS: Record<LLMProvider, Record<LlmMode, string>> = {
  gemini:             { quick: "gemini-2.5-flash",       deep: "gemini-2.5-flash"       },
  // quick → 8B (analysts — speed over depth); deep → 70B (synthesis / portfolio node)
  groq:               { quick: "llama-3.1-8b-instant",   deep: "llama-3.3-70b-versatile" },
  ollama:             { quick: "gemma3:12b",              deep: "llama3.2:latest"         },
  "openai-compatible": { quick: "",                       deep: ""                        },
};

// ─── Env-var model resolver — now Groq-backed ─────────────────────────────────

/**
 * Returns the default model ID for the given mode, respecting env overrides.
 * Defaults to the Groq model catalogue. Kept for backward compatibility with
 * callers that referenced getModelId() in the Gemini era.
 */
export function getModelId(mode: LlmMode = "quick"): string {
  const envKey = `LLM_${mode.toUpperCase()}_MODEL`;
  return process.env[envKey] ?? PROVIDER_DEFAULTS.groq[mode];
}

// ─── Provider-specific constructors (lazy) ────────────────────────────────────

/**
 * @deprecated Gemini API is banned per the 2026-06-17 architectural decision.
 * This builder exists only so that legacy backtest_jobs records with
 * llm_provider='gemini' don't crash on replay. New code should not call this.
 */
async function buildGemini(_mode: LlmMode, config?: LLMConfig): Promise<BaseChatModel> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Gemini provider is deprecated and GOOGLE_GENERATIVE_AI_API_KEY is not set. " +
        "Switch to provider='groq'.",
    );
  }
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  const model = config?.model ?? "gemini-2.5-flash";
  return new ChatGoogleGenerativeAI({ model, apiKey }) as unknown as BaseChatModel;
}

async function buildGroq(mode: LlmMode, config?: LLMConfig): Promise<BaseChatModel> {
  const { ChatGroq } = await import("@langchain/groq");
  const apiKey = config?.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is required (pass via LLMConfig.apiKey or GROQ_API_KEY env var)");
  }
  const model = config?.model || PROVIDER_DEFAULTS.groq[mode];
  return new ChatGroq({ model, apiKey }) as unknown as BaseChatModel;
}

async function buildOllama(mode: LlmMode, config: LLMConfig): Promise<BaseChatModel> {
  const { ChatOllama } = await import("@langchain/ollama");
  const model = config.model || PROVIDER_DEFAULTS.ollama[mode];
  const baseUrl = config.baseUrl ?? "http://localhost:11434";
  return new ChatOllama({ model, baseUrl }) as unknown as BaseChatModel;
}

async function buildOpenAICompatible(mode: LlmMode, config: LLMConfig): Promise<BaseChatModel> {
  const { ChatOpenAI } = await import("@langchain/openai");
  const apiKey = config.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY ?? "ollama";
  if (!config.baseUrl) {
    throw new Error("LLMConfig.baseUrl is required for openai-compatible provider");
  }
  const model = config.model || PROVIDER_DEFAULTS["openai-compatible"][mode];
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL: config.baseUrl },
  }) as unknown as BaseChatModel;
}

// ─── Public factory ────────────────────────────────────────────────────────────

/**
 * Returns a LangChain chat model for the given mode and optional config.
 *
 * Defaults to Groq Llama 3.1 8B (quick) or 3.3 70B (deep) per the 2026-06-17
 * architectural decision banning paid LLM APIs. Pass `provider: "gemini"`
 * explicitly only to replay legacy backtest records.
 *
 * @param mode   - "quick" (analysts) or "deep" (synthesis / portfolio)
 * @param config - Optional provider config. Defaults to Groq when absent.
 */
export async function getLlm(
  mode: LlmMode = "quick",
  config?: LLMConfig,
): Promise<BaseChatModel> {
  const provider = config?.provider ?? "groq";

  switch (provider) {
    case "groq":
      return buildGroq(mode, config);
    case "gemini":
      return buildGemini(mode, config);
    case "ollama":
      return buildOllama(mode, config!);
    case "openai-compatible":
      return buildOpenAICompatible(mode, config!);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
}
