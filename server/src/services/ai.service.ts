import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * One small text-in/text-out helper over whichever AI provider is enabled in
 * server/.env. Claude goes through the official SDK; OpenAI, Groq and Mistral
 * share the OpenAI-compatible chat completions API.
 */
export type AiProvider = 'claude' | 'openai' | 'groq' | 'mistral';

type ProviderConfig = { provider: AiProvider; apiKey: string; model: string };

const OPENAI_COMPATIBLE: Record<Exclude<AiProvider, 'claude'>, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest' },
};

const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

function configured(): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  if (env.isClaudeEnabled && env.claudeApiKey) {
    out.push({ provider: 'claude', apiKey: env.claudeApiKey, model: env.claudeModel || DEFAULT_CLAUDE_MODEL });
  }
  if (env.isOpenaiEnabled && env.openaiApiKey) {
    out.push({ provider: 'openai', apiKey: env.openaiApiKey, model: env.openaiModel || OPENAI_COMPATIBLE.openai.defaultModel });
  }
  if (env.isGroqEnabled && env.groqApiKey) {
    out.push({ provider: 'groq', apiKey: env.groqApiKey, model: env.groqModel || OPENAI_COMPATIBLE.groq.defaultModel });
  }
  if (env.isMistralEnabled && env.mistralApiKey) {
    out.push({ provider: 'mistral', apiKey: env.mistralApiKey, model: env.mistralModel || OPENAI_COMPATIBLE.mistral.defaultModel });
  }
  return out;
}

/** `AI_PROVIDER` picks one when several are enabled; otherwise the first in the list above. */
function activeProvider(): ProviderConfig | null {
  const all = configured();
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  return all.find((p) => p.provider === wanted) ?? all[0] ?? null;
}

export function getAiStatus(): { enabled: boolean; provider: AiProvider | null; model: string | null } {
  const p = activeProvider();
  return { enabled: Boolean(p), provider: p?.provider ?? null, model: p?.model ?? null };
}

let claudeClient: Anthropic | null = null;

async function completeClaude(cfg: ProviderConfig, system: string, user: string, maxTokens: number): Promise<string> {
  claudeClient ??= new Anthropic({ apiKey: cfg.apiKey, timeout: 120_000, maxRetries: 2 });
  try {
    const response = await claudeClient.beta.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      // Short workplace writing tasks — low effort keeps them fast and cheap.
      output_config: { effort: 'low' },
      // If a request is declined by a safety classifier, retry on Anthropic's default fallback model.
      ...(FALLBACK_MODELS.has(cfg.model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    });
    if (response.stop_reason === 'refusal') {
      throw new ApiError(422, 'The AI declined this request.');
    }
    return response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, 'AI rate limit reached — try again shortly.');
    if (err instanceof Anthropic.AuthenticationError) throw new ApiError(503, 'AI provider key is invalid.');
    if (err instanceof Anthropic.APIError) throw new ApiError(502, `AI request failed (${err.status ?? 'network'})`);
    throw err;
  }
}

async function completeOpenAiCompatible(
  cfg: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number,
  json: boolean
): Promise<string> {
  const { baseUrl } = OPENAI_COMPATIBLE[cfg.provider as Exclude<AiProvider, 'claude'>];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 429) throw new ApiError(429, 'AI rate limit reached — try again shortly.');
  if (res.status === 401 || res.status === 403) throw new ApiError(503, 'AI provider key is invalid.');
  if (!res.ok) throw new ApiError(502, `AI request failed (${res.status})`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return String(data.choices?.[0]?.message?.content ?? '').trim();
}

export async function aiComplete(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  /** Ask for a single JSON object back (parsed by `aiJson`). */
  json?: boolean;
}): Promise<string> {
  const cfg = activeProvider();
  if (!cfg) {
    throw new ApiError(503, 'AI is not configured. Enable a provider (e.g. IS_CLAUDE_ENABLED + CLAUDE_API_KEY) in server/.env.');
  }
  const maxTokens = opts.maxTokens ?? 4000;
  const system = opts.json
    ? `${opts.system}\n\nRespond with a single JSON object only — no prose, no code fences.`
    : opts.system;
  return cfg.provider === 'claude'
    ? completeClaude(cfg, system, opts.user, maxTokens)
    : completeOpenAiCompatible(cfg, system, opts.user, maxTokens, Boolean(opts.json));
}

/** Pull the first JSON object out of a model reply (tolerates stray fences/prose). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new ApiError(502, 'AI returned an unreadable answer — try again.');
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    throw new ApiError(502, 'AI returned an unreadable answer — try again.');
  }
}

export async function aiJson<T>(opts: { system: string; user: string; maxTokens?: number }): Promise<T> {
  return extractJson<T>(await aiComplete({ ...opts, json: true }));
}
