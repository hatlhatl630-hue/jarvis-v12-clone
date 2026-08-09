// ═══════════════════════════════════════════════
// JARVIS v11 — Multi-Provider Router
// Provider 0: Personal Ollama Model (your own GPU, free, unlimited)
// Provider 1: Cerebras (FREE, 70B Llama, no credit card, insane speed)
// Provider 2-6: Cloud API fallbacks
// ═══════════════════════════════════════════════

interface LLMResponse {
  content: string;
  provider: string;
  model: string;
}

// ─── COOLDOWN TRACKING ───
const cooldowns = new Map<string, number>();
let lastProvider = 'none';

function cooldown(name: string, ms: number) { cooldowns.set(name, Date.now() + ms); }
function isReady(name: string): boolean { return Date.now() >= (cooldowns.get(name) || 0); }

// ─── PROVIDER 0: PERSONAL MODEL (Ollama — FREE, UNLIMITED) ───
// Runs on YOUR machine via cloudflared tunnel. No API keys, no quotas.
// Setup: https://github.com/nicehash/cloudflared  +  ollama.com
// Env var: PERSONAL_MODEL_URL (e.g. https://your-tunnel.trycloudflare.com/v1)
let PERSONAL_MODEL_URL = '';
let PERSONAL_MODEL_NAME = 'qwen2.5:14b';

export function setPersonalModel(url: string, model?: string) {
  if (url) {
    PERSONAL_MODEL_URL = url.replace(/\/+$/, '');
    if (model) PERSONAL_MODEL_NAME = model;
    console.log(`[Router] Personal model configured: ${PERSONAL_MODEL_URL} (${PERSONAL_MODEL_NAME})`);
  }
}

async function callPersonalModel(messages: any[]): Promise<LLMResponse | null> {
  if (!PERSONAL_MODEL_URL || !isReady('personal')) return null;
  try {
    const res = await fetch(`${PERSONAL_MODEL_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PERSONAL_MODEL_NAME,
        messages: messages.map((m: any) => ({ role: m.role, content: String(m.content) })),
        max_tokens: 4096,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.log(`[Router] Personal model ${res.status} — cooling down 30s`);
      cooldown('personal', 30_000);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (content.trim()) {
      lastProvider = 'Personal Model';
      return { content: content.trim(), provider: 'Personal Model', model: PERSONAL_MODEL_NAME };
    }
  } catch (e: any) {
    console.log(`[Router] Personal model failed: ${e.message}`);
    cooldown('personal', 30_000);
  }
  return null;
}

// ─── PROVIDER 1: CEREBRAS (FREE — 70B model, no credit card, ~1000 tok/s) ───
// Signup: https://cloud.cerebras.ai (email only, instant API key)
let CEREBRAS_KEY = process.env.CEREBRAS_API_KEY || '';
const CEREBRAS_MODEL = 'llama-3.3-70b';

async function callCerebras(messages: any[]): Promise<LLMResponse | null> {
  if (!CEREBRAS_KEY || !isReady('cerebras')) return null;
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CEREBRAS_KEY}` },
      body: JSON.stringify({ model: CEREBRAS_MODEL, messages, max_tokens: 4096, temperature: 0.7 }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) { cooldown('cerebras', 30_000); return null; }
    if (res.status === 401 || res.status === 403) { cooldown('cerebras', 30_000); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    if (content.trim()) { lastProvider = 'Cerebras'; return { content: content.trim(), provider: 'Cerebras', model: CEREBRAS_MODEL }; }
  } catch (e: any) {
    console.log(`[Router] Cerebras failed: ${e.message}`);
    cooldown('cerebras', 30_000);
  }
  return null;
}

// ─── PROVIDER 2: SAMBANOVA (FREE — 70B models, no credit card) ───
// Signup: https://cloud.sambanova.ai (email only, instant API key)
let SAMBANOVA_KEY = process.env.SAMBANOVA_API_KEY || '';
const SAMBANOVA_MODELS = ['Meta-Llama-3.3-70B-Instruct', 'Qwen2.5-72B-Instruct'];

async function callSambaNova(messages: any[]): Promise<LLMResponse | null> {
  if (!SAMBANOVA_KEY || !isReady('sambanova')) return null;
  for (const model of SAMBANOVA_MODELS) {
    try {
      const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SAMBANOVA_KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.7, stream: false }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) { cooldown('sambanova', 30_000); return null; }
      if (res.status === 401 || res.status === 403) { cooldown('sambanova', 30_000); return null; }
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      if (content.trim()) { lastProvider = 'SambaNova'; return { content: content.trim(), provider: 'SambaNova', model }; }
    } catch { continue; }
  }
  return null;
}

// ─── PROVIDER 3: OPENROUTER ───
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_MODELS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-31b-it:free',
];

async function callOpenRouter(messages: any[]): Promise<LLMResponse | null> {
  if (!OR_KEY || !isReady('openrouter')) return null;
  for (const model of OR_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OR_KEY}`,
          'HTTP-Referer': 'https://jarvis-v6.pages.dev',
          'X-Title': 'JARVIS-v6',
        },
        body: JSON.stringify({ model, messages, max_tokens: 4096 }),
      });
      if (res.status === 429) { cooldown('openrouter', 60_000); return null; }
      if (res.status === 401 || res.status === 403) { cooldown('openrouter', 30_000); return null; }
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      if (content.trim()) { lastProvider = 'openrouter'; return { content: content.trim(), provider: 'OpenRouter', model }; }
    } catch { continue; }
  }
  return null;
}

// ─── PROVIDER 4: GEMINI ───
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS = ['gemini-2.0-flash-lite', 'gemini-1.5-flash'];

async function callGemini(messages: any[]): Promise<LLMResponse | null> {
  if (!GEMINI_KEY || !isReady('gemini')) return null;
  const systemMsg = messages.find((m: any) => m.role === 'system');
  const nonSystem = messages.filter((m: any) => m.role !== 'system');
  const contents = nonSystem.map((m: any) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content) }],
  }));

  for (const model of GEMINI_MODELS) {
    try {
      const body: any = { contents, generationConfig: { maxOutputTokens: 4096 } };
      if (systemMsg) body.systemInstruction = { parts: [{ text: String(systemMsg.content) }] };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) { cooldown('gemini', 60_000); return null; }
      if (res.status === 401 || res.status === 403) { cooldown('gemini', 30_000); return null; }
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text.trim()) { lastProvider = 'Gemini'; return { content: text.trim(), provider: 'Gemini', model }; }
    } catch { continue; }
  }
  return null;
}

// ─── PROVIDER 5: CLOUDFLARE WORKERS AI ───
let cfAi: any = null;
export function setCloudflareAI(ai: any) { cfAi = ai; }

// Set API keys from CF Worker env at runtime
export function setProviderKeys(keys: { cerebras?: string; sambanova?: string; openrouter?: string; gemini?: string; groq?: string }) {
  if (keys.cerebras) CEREBRAS_KEY = keys.cerebras;
  if (keys.sambanova) SAMBANOVA_KEY = keys.sambanova;
  if (keys.openrouter && !OR_KEY) { /* OR_KEY is const, handled at module level */ }
  if (keys.gemini && !GEMINI_KEY) { /* same */ }
  if (keys.groq && !GROQ_KEY) { /* same */ }
  // Update PROVIDERS availability
  PROVIDERS[1].available = CEREBRAS_KEY.length > 10;  // Cerebras
  PROVIDERS[2].available = SAMBANOVA_KEY.length > 10;  // SambaNova
  console.log(`[Router] Keys updated: Cerebras=${CEREBRAS_KEY ? 'yes' : 'no'}, SambaNova=${SAMBANOVA_KEY ? 'yes' : 'no'}`);
}

async function callCloudflare(messages: any[]): Promise<LLMResponse | null> {
  if (!cfAi || !isReady('cloudflare')) return null;
  try {
    const result = await cfAi.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
    });
    const text = (result as any).response || (result as any).output || '';
    if (text.trim()) { lastProvider = 'Cloudflare AI'; return { content: text.trim(), provider: 'Cloudflare AI', model: 'llama-4-scout' }; }
    cooldown('cloudflare', 120_000);
  } catch { cooldown('cloudflare', 120_000); }
  return null;
}

// ─── PROVIDER 6: GROQ ───
const GROQ_KEY = process.env.GROQ_API_KEYS || '';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-4-scout-17b-16e-instruct'];

async function callGroq(messages: any[]): Promise<LLMResponse | null> {
  if (!GROQ_KEY || !isReady('groq')) return null;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.7 }),
      });
      if (res.status === 429 || res.status === 503) { cooldown('groq', 30_000); return null; }
      if (res.status === 401 || res.status === 403) { cooldown('groq', 30_000); return null; }
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      if (content.trim()) { lastProvider = 'Groq'; return { content: content.trim(), provider: 'Groq', model }; }
    } catch { continue; }
  }
  return null;
}

// ─── SMART ROUTER ───
interface ProviderDef {
  name: string;
  call: (messages: any[]) => Promise<LLMResponse | null>;
  available: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { name: 'Personal Model', call: callPersonalModel, available: false },
  { name: 'Cerebras', call: callCerebras, available: CEREBRAS_KEY.length > 10 },      // FREE 70B, no credit card
  { name: 'SambaNova', call: callSambaNova, available: SAMBANOVA_KEY.length > 10 }, // FREE 70B, no credit card
  { name: 'OpenRouter', call: callOpenRouter, available: !!OR_KEY },
  { name: 'Gemini', call: callGemini, available: !!GEMINI_KEY },
  { name: 'Cloudflare AI', call: callCloudflare, available: true },
  { name: 'Groq', call: callGroq, available: GROQ_KEY.length > 10 },
];

async function route(messages: any[]): Promise<LLMResponse> {
  // Try each ready provider with 15s timeout
  for (const provider of PROVIDERS) {
    if (!provider.available || !isReady(provider.name)) continue;
    try {
      const result = await Promise.race([
        provider.call(messages),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      if (result) return result;
    } catch (e: any) {
      console.log(`[Router] ${provider.name} failed: ${e.message}`);
      continue;
    }
  }

  // If all on cooldown, clear the shortest one and retry once
  let shortest: string | null = null;
  let shortestTime = Infinity;
  cooldowns.forEach((cd, name) => {
    if (cd < shortestTime) { shortestTime = cd; shortest = name; }
  });
  if (shortest) {
    cooldowns.delete(shortest);
    const p = PROVIDERS.find(pr => pr.name === shortest);
    if (p) {
      const result = await Promise.race([
        p.call(messages),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      if (result) return result;
    }
  }

  throw new Error('All AI providers are temporarily unavailable. Please try again.');
}

// ─── EXPORTS ───
export function getProviders() {
  return PROVIDERS.map(p => ({
    name: p.name,
    available: p.available,
    active: isReady(p.name),
  }));
}

export function getPersonalModelInfo() {
  return PERSONAL_MODEL_URL
    ? { configured: true, url: PERSONAL_MODEL_URL, model: PERSONAL_MODEL_NAME }
    : { configured: false, url: '', model: '' };
}

export function getLastProvider() { return lastProvider; }

export { route };

// ─── TARGETED ROUTE (call specific provider only) ───
export async function routeWithProvider(providerName: string, messages: any[], timeoutMs: number = 20000): Promise<LLMResponse> {
  const provider = PROVIDERS.find(p => p.name.toLowerCase().includes(providerName.toLowerCase()));
  if (!provider) throw new Error(`Provider ${providerName} not found`);

  const result = await Promise.race([
    provider.call(messages),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);

  if (!result) throw new Error(`${providerName} returned empty response`);
  return result;
}

// ─── PERSONAL MODEL HEALTH CHECK ───
export async function checkPersonalModel(): Promise<{ ok: boolean; model: string; error?: string }> {
  if (!PERSONAL_MODEL_URL) return { ok: false, model: '', error: 'Not configured. Set PERSONAL_MODEL_URL env var.' };
  try {
    const res = await fetch(`${PERSONAL_MODEL_URL}/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, model: PERSONAL_MODEL_NAME, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data?.models || []).map((m: any) => m.name);
    const found = models.find((n: string) => n.includes(PERSONAL_MODEL_NAME.split(':')[0]));
    return { ok: true, model: found || PERSONAL_MODEL_NAME };
  } catch (e: any) {
    return { ok: false, model: PERSONAL_MODEL_NAME, error: e.message };
  }
}
