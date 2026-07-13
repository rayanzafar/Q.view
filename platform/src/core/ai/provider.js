// Provider-agnostic LLM client. Order of preference: Anthropic → OpenAI → local heuristic.
// The platform WORKS with no key (local engine); a key upgrades quality. All external
// calls receive ONLY redacted context (see assistant.js — sensitive fields stripped first).
import { config } from '../config.js';

export function aiMode() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (config.ai.apiKey) return 'openai';
  return 'local';
}

// Low-level completion. Returns { text } or throws. Never called with sensitive data.
export async function complete({ system, user, maxTokens = 800 }) {
  const mode = aiMode();
  if (mode === 'anthropic') return anthropic(system, user, maxTokens);
  if (mode === 'openai') return openai(system, user, maxTokens);
  throw new Error('no_llm_key'); // caller falls back to local engine
}

async function anthropic(system, user, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5', max_tokens: maxTokens,
      system, messages: [{ role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const j = await r.json();
  return { text: (j.content || []).map((c) => c.text).join('') };
}

async function openai(system, user, maxTokens) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.ai.apiKey },
    body: JSON.stringify({ model: config.ai.model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('openai ' + r.status);
  const j = await r.json();
  return { text: j.choices?.[0]?.message?.content || '' };
}
