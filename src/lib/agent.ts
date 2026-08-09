// JARVIS v12 — Full Autonomous Agent
// Self-healing, self-cloning, never stops

export interface AgentConfig {
  githubToken: string;
  githubRepo: string;
  githubBranch: string;
  cfApiToken: string;
  cfAccountId: string;
}

export interface ActionBlock {
  tool: string;
  params: Record<string, any>;
  raw: string;
}

export interface ActionResult {
  tool: string;
  success: boolean;
  result: string;
  duration: number;
}

export interface TodoBlock {
  text: string;
  priority: 'high' | 'medium' | 'low';
}

function extractBracedBlocks(text: string, marker: string): { content: string; startIndex: number; endIndex: number }[] {
  const results: { content: string; startIndex: number; endIndex: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const markerIdx = text.indexOf(marker, i);
    if (markerIdx === -1) break;
    let braceIdx = markerIdx + marker.length;
    while (braceIdx < text.length && text[braceIdx] !== '{') braceIdx++;
    if (braceIdx >= text.length) break;
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let j = braceIdx;
    let found = false;
    while (j < text.length) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\' && j + 1 < text.length) { j += 2; continue; }
        if (ch === stringChar) inString = false;
      } else {
        if (ch === '"' || ch === "'") { inString = true; stringChar = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            results.push({ content: text.substring(braceIdx, j + 1), startIndex: markerIdx, endIndex: j + 1 });
            i = j + 1;
            found = true;
            break;
          }
        }
      }
      j++;
    }
    if (!found) break;
  }
  return results;
}

export function extractActions(text: string): { cleanText: string; actions: ActionBlock[] } {
  const blocks = extractBracedBlocks(text, '[JARVIS_ACTION:');
  const actions: ActionBlock[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.content);
      if (parsed.tool) actions.push({ tool: parsed.tool, params: parsed.params || {}, raw: block.content });
    } catch {}
  }
  let cleanText = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    cleanText = cleanText.substring(0, blocks[i].startIndex) + cleanText.substring(blocks[i].endIndex);
  }
  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), actions };
}

export function extractTodos(text: string): { cleanText: string; todos: TodoBlock[] } {
  const blocks = extractBracedBlocks(text, '[JARVIS_TODO:');
  const todos: TodoBlock[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.content);
      if (parsed.text) todos.push({ text: parsed.text, priority: parsed.priority || 'medium' });
    } catch {}
  }
  let cleanText = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    cleanText = cleanText.substring(0, blocks[i].startIndex) + cleanText.substring(blocks[i].endIndex);
  }
  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), todos };
}

async function githubApi(config: AgentConfig, method: string, path: string, body?: any, repoOverride?: string): Promise<any> {
  const repo = repoOverride || config.githubRepo;
  const url = `https://api.github.com/repos/${repo}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.githubToken}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'JARVIS-AI/12.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const fix = getGithubFix(res.status, errText);
    throw new Error(`GitHub API ${res.status}: ${errText.slice(0, 300)}\n${fix}`);
  }
  return res.json();
}

function getGithubFix(status: number, err: string): string {
  if (status === 401) return 'FIX: GITHUB_TOKEN invalid. Ask user: npx wrangler secret put GITHUB_TOKEN';
  if (status === 403 && err.includes('rate limit')) return 'FIX: Rate limited. Wait 60s and retry.';
  if (status === 403 && err.includes('permission')) return 'FIX: Token lacks permission. Needs repo scope.';
  if (status === 404) return 'FIX: File/repo not found. Use list_files first.';
  if (status === 422 && err.includes('sha')) return 'FIX: SHA conflict. Re-read file, then update again.';
  return 'Retry with different approach. Search web for the exact error.';
}

async function toolReadFile(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { path, repo } = params;
  if (!path) throw new Error('Missing "path". Usage: {"tool":"read_file","params":{"path":"src/lib/agent.ts"}}');
  const data = await githubApi(config, 'GET', `/contents/${path}`, undefined, repo);
  if (Array.isArray(data)) {
    return `Directory: ${path}\n${data.map((item: any) => `  ${item.type === 'dir' ? '[DIR]' : '[FILE]'} ${item.name}`).join('\n')}\n(${data.length} items)`;
  }
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return `File: ${path} (${content.split('\n').length} lines, sha: ${data.sha?.slice(0, 7) || 'N/A'})\n${'='.repeat(50)}\n${content}`;
}

async function toolListFiles(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const path = params.path || '';
  const data = await githubApi(config, 'GET', `/contents/${path}`);
  if (!Array.isArray(data)) return `File: ${data.name} (${data.type}) - use read_file`;
  return data.map((item: any) => {
    const icon = item.type === 'dir' ? '[DIR]' : '[FILE]';
    const size = item.type === 'file' ? ` (${formatBytes(item.size)})` : '';
    return `  ${icon} ${item.name}${size}`;
  }).join('\n') + `\n(${data.length} items in ${path || '/'})`;
}

async function toolSelfUpdate(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { path, content, commitMessage, repo } = params;
  if (!path || content === undefined) throw new Error('Missing "path" or "content". Content must be COMPLETE file.');
  if (content.length < 10) throw new Error('Content too short. Provide COMPLETE file.');
  const targetRepo = repo || config.githubRepo;
  let sha: string | undefined;
  try { const existing = await githubApi(config, 'GET', `/contents/${path}`, undefined, targetRepo); sha = existing.sha; } catch {}
  const encoded = Buffer.from(content, 'utf-8').toString('base64');
  const result = await githubApi(config, 'PUT', `/contents/${path}`, {
    message: commitMessage || `Update ${path} via JARVIS`, content: encoded, ...(sha ? { sha } : {}),
  }, targetRepo);
  return `Updated ${path} in ${targetRepo} - commit ${result.commit?.sha?.slice(0, 7) || 'unknown'}`;
}

async function toolBatchUpdate(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { files, commitMessage, repo } = params;
  if (!files || !Array.isArray(files) || files.length === 0) throw new Error('Missing "files" array.');
  const targetRepo = repo || config.githubRepo;
  const branchData = await githubApi(config, 'GET', `/branches/${config.githubBranch}`, undefined, targetRepo);
  const commitSha = branchData.commit.sha;
  const commitData = await githubApi(config, 'GET', `/commits/${commitSha}`, undefined, targetRepo);
  const treeSha = commitData.commit.tree.sha;
  const treeItems = await Promise.all(files.map(async (file: any) => {
    if (!file.path || file.content === undefined) throw new Error(`Each file needs "path" and "content".`);
    const blob = await githubApi(config, 'POST', '/git/blobs', { content: file.content, encoding: 'utf-8' }, targetRepo);
    return { path: file.path, mode: '100644', type: 'blob' as const, sha: blob.sha };
  }));
  const newTree = await githubApi(config, 'POST', '/git/trees', { base_tree: treeSha, tree: treeItems }, targetRepo);
  const newCommit = await githubApi(config, 'POST', '/git/commits', {
    message: commitMessage || `Batch update ${files.length} files via JARVIS`, tree: newTree.sha, parents: [commitSha],
  }, targetRepo);
  await githubApi(config, 'PATCH', `/git/refs/heads/${config.githubBranch}`, { sha: newCommit.sha }, targetRepo);
  return `Committed ${files.length} files to ${targetRepo} in ${newCommit.sha.slice(0, 7)}\nFiles: ${files.map((f: any) => f.path).join(', ')}`;
}

async function toolCreateRepo(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { name, description, private: isPrivate } = params;
  if (!name) throw new Error('Missing repo name.');
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JARVIS-AI/12.0', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description || `JARVIS v12 - ${name}`, auto_init: true, private: isPrivate !== false }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    if (res.status === 422 && err.includes('already exists')) return `Repo ${name} already exists at https://github.com/${config.githubRepo.split('/')[0]}/${name}`;
    throw new Error(`Create repo ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return `Repo created: ${data.html_url}\nClone: ${data.clone_url}\nFull name: ${data.full_name}`;
}

async function toolCloneJarvis(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { repoName, description } = params;
  if (!repoName) throw new Error('Missing repoName. Usage: {"tool":"clone_jarvis","params":{"repoName":"jarvis-new"}}');
  const owner = config.githubRepo.split('/')[0];
  const targetRepo = `${owner}/${repoName}`;
  const log: string[] = [];

  log.push(`Creating repo ${repoName}...`);
  try {
    const r = await toolCreateRepo({ name: repoName, description: description || 'JARVIS v12 - Autonomous Agent', private: false }, config);
    log.push(r);
  } catch (e: any) {
    if (!e.message.includes('already exists')) throw e;
    log.push(`Repo already exists, reusing.`);
  }

  const filesToClone = [
    'package.json', 'tsconfig.json', 'next.config.ts', 'wrangler.toml',
    'src/app/layout.tsx', 'src/app/globals.css', 'src/app/page.tsx',
    'src/app/api/chat/route.ts', 'src/app/api/ping/route.ts',
    'src/lib/router.ts', 'src/lib/agent.ts',
  ];

  log.push(`Reading ${filesToClone.length} files from ${config.githubRepo}...`);
  const fileContents: { path: string; content: string }[] = [];

  for (const filePath of filesToClone) {
    try {
      const data = await githubApi(config, 'GET', `/contents/${filePath}`);
      if (Array.isArray(data)) continue;
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      let finalContent = content;
      if (filePath === 'wrangler.toml') {
        finalContent = content.replace(/^name = ".*"/m, `name = "${repoName}"`);
      }
      if (filePath === 'src/app/api/chat/route.ts') {
        finalContent = content.replace(/hatlhatl630-hue\/jarvis-ai/g, targetRepo);
      }
      fileContents.push({ path: filePath, content: finalContent });
      log.push(`  [OK] ${filePath} (${content.length} chars)`);
    } catch (e: any) {
      log.push(`  [SKIP] ${filePath}: ${e.message.slice(0, 80)}`);
    }
  }

  if (fileContents.length === 0) throw new Error('Failed to read ANY files. Check GITHUB_TOKEN.');

  log.push(`Pushing ${fileContents.length} files to ${targetRepo}...`);
  try {
    const r = await toolBatchUpdate({ files: fileContents, commitMessage: 'JARVIS v12 clone - full autonomous agent', repo: targetRepo }, config);
    log.push(r);
  } catch (e: any) {
    log.push(`Batch failed, trying individual pushes...`);
    for (const file of fileContents) {
      try {
        const r = await toolSelfUpdate({ path: file.path, content: file.content, commitMessage: `Add ${file.path}`, repo: targetRepo }, config);
        log.push(`  [OK] ${r}`);
      } catch (e2: any) {
        log.push(`  [FAIL] ${file.path}: ${e2.message.slice(0, 100)}`);
      }
    }
  }

  const repoUrl = `https://github.com/${targetRepo}`;
  log.push(`\n=== CLONE COMPLETE ===`);
  log.push(`New repo: ${repoUrl}`);
  log.push(`Files: ${fileContents.length}/${filesToClone.length}`);
  log.push(`\nTo deploy:`);
  log.push(`1. git clone ${repoUrl} && cd ${repoName}`);
  log.push(`2. npm install`);
  log.push(`3. npx wrangler login`);
  log.push(`4. npx wrangler secret put GITHUB_TOKEN`);
  log.push(`5. npm run deploy`);
  return log.join('\n');
}

async function toolDeployCloudflare(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { repoName, projectName } = params;
  if (!config.cfApiToken) throw new Error('No CLOUDFLARE_API_TOKEN. Add via: npx wrangler secret put CLOUDFLARE_API_TOKEN');
  if (!config.cfAccountId) throw new Error('No CLOUDFLARE_ACCOUNT_ID. Add to wrangler.toml [vars].');
  const owner = config.githubRepo.split('/')[0];
  const repo = repoName || config.githubRepo.split('/')[1];
  const project = projectName || repo;
  const log: string[] = [];

  log.push(`Creating CF Pages project: ${project}...`);
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/pages/projects`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.cfApiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project, production_branch: 'main',
          source: { type: 'github', config: { owner, repo_name: repo, production_branch: 'main', pr_comments_enabled: false, deployments_enabled: true } },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const data = await res.json();
    if (data.success) {
      const url = `https://${project}.pages.dev`;
      log.push(`Pages project created! URL: ${url}`);
      log.push(`Wait 2-3 min for first deploy.`);
      return log.join('\n');
    }
    if (data.errors?.[0]?.message?.includes('already exists')) {
      const url = `https://${project}.pages.dev`;
      log.push(`Project already exists at ${url}`);
      return log.join('\n');
    }
    throw new Error(`CF API: ${JSON.stringify(data.errors?.slice(0, 2)).slice(0, 300)}`);
  } catch (e: any) {
    if (e.message.startsWith('CF API')) throw e;
    throw new Error(`CF deploy failed: ${e.message}`);
  }
}

async function toolDeleteFile(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { path, repo } = params;
  if (!path) throw new Error('Missing "path"');
  const targetRepo = repo || config.githubRepo;
  let sha: string;
  try { const e = await githubApi(config, 'GET', `/contents/${path}`, undefined, targetRepo); sha = e.sha; } catch (e: any) { throw new Error(`Cannot delete: ${e.message}`); }
  await githubApi(config, 'DELETE', `/contents/${path}`, { message: `Delete ${path}`, sha }, targetRepo);
  return `Deleted ${path} from ${targetRepo}`;
}

async function toolCreateBranch(params: Record<string, any>, config: AgentConfig): Promise<string> {
  const { branch, from } = params;
  if (!branch) throw new Error('Missing "branch"');
  const sourceBranch = from || config.githubBranch;
  const refData = await githubApi(config, 'GET', `/git/ref/heads/${sourceBranch}`);
  await githubApi(config, 'POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: refData.object.sha });
  return `Branch "${branch}" created from "${sourceBranch}"`;
}

async function searchGoogleSuggest(query: string): Promise<string[]> {
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'JARVIS-AI/12.0' }, signal: AbortSignal.timeout(5000) });
    if (res.ok) { const data = await res.json(); return Array.isArray(data?.[1]) ? data[1].slice(0, 6) : []; }
  } catch {}
  return [];
}

async function searchWikipedia(query: string): Promise<{ title: string; extract: string; url: string }[]> {
  const results: { title: string; extract: string; url: string }[] = [];
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3&utf8=1`, { headers: { 'Accept': 'application/json', 'User-Agent': 'JARVIS-AI/12.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return results;
    const data = await res.json();
    for (const item of (data?.query?.search || [])) {
      const title = item.title;
      const snippet = item.snippet.replace(/<[^>]+>/g, '');
      let extract = snippet;
      let url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      try {
        const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { 'User-Agent': 'JARVIS-AI/12.0' }, signal: AbortSignal.timeout(5000) });
        if (sumRes.ok) { const sd = await sumRes.json(); if (sd.extract) extract = sd.extract; if (sd.content_urls?.desktop?.href) url = sd.content_urls.desktop.href; }
      } catch {}
      results.push({ title, extract, url });
    }
  } catch {}
  return results;
}

async function searchDDG(query: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&t=jarvis`, { headers: { 'User-Agent': 'JARVIS-AI/12.0' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || !text.startsWith('{')) return null;
    const data = JSON.parse(text);
    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Answer) parts.push(`Answer: ${data.Answer}`);
    return parts.length > 0 ? parts.join('\n\n') : null;
  } catch {}
  return null;
}

async function searchGeminiGoogle(query: string): Promise<string | null> {
  const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
  if (!GEMINI_KEY) return null;
  for (const model of ['gemini-2.0-flash-lite', 'gemini-2.0-flash']) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Search: ${query}\n\nTop results with URLs.` }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 2048, temperature: 0.1 } }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) return null;
      if (!res.ok) continue;
      const data = await res.json();
      const candidate = data?.candidates?.[0];
      if (!candidate) continue;
      const chunks = ((candidate.groundingMetadata || {}).groundingChunks || []).filter((c: any) => c.web).map((c: any) => c.web);
      const text = candidate?.content?.parts?.[0]?.text || '';
      if (chunks.length > 0) {
        const lines: string[] = [`[Google Search] ${chunks.length} results:`];
        for (let i = 0; i < Math.min(chunks.length, 6); i++) lines.push(`  ${i + 1}. ${chunks[i].title || ''} - ${chunks[i].uri || ''}`);
        if (text.trim()) lines.push(`\n[Summary] ${text.trim().slice(0, 1000)}`);
        return lines.join('\n');
      }
    } catch { continue; }
  }
  return null;
}

async function toolSearchWeb(params: Record<string, any>): Promise<string> {
  const query = params.query;
  if (!query) throw new Error('Missing "query".');
  try { const r = await searchGeminiGoogle(query); if (r) return r; } catch {}
  const [suggestions, wikiResults] = await Promise.all([searchGoogleSuggest(query), searchWikipedia(query)]);
  const output: string[] = [];
  for (const r of wikiResults) { output.push(`${r.title}: ${r.extract.slice(0, 250)}`); output.push(`  URL: ${r.url}`); }
  if (wikiResults.length === 0) { const ddg = await searchDDG(query); if (ddg) output.push(`[DDG] ${ddg}`); }
  if (suggestions.length > 0) output.push(`\nRelated: ${suggestions.join(' | ')}`);
  if (output.length > 0) return `Results for "${query}":\n\n${output.join('\n')}`;
  return `No results for "${query}". Try different search terms.`;
}

async function toolFetchUrl(params: Record<string, any>): Promise<string> {
  const { url } = params;
  if (!url) throw new Error('Missing "url"');
  const res = await fetch(url, { headers: { 'User-Agent': 'JARVIS-AI/12.0' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const text = await res.text();
  return text.length > 8000 ? text.slice(0, 8000) + '...[truncated]' : text;
}

async function toolSaveKnowledge(params: Record<string, any>): Promise<string> {
  const { category, key, value } = params;
  if (!category || !key || !value) throw new Error('Missing category, key, or value');
  return `Knowledge saved: ${category}/${key}`;
}

export async function executeActions(actions: ActionBlock[], config: AgentConfig, sendEvent: (data: any) => void): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    const startTime = Date.now();
    sendEvent({ type: 'action', phase: 'action', label: `Executing: ${action.tool}`, detail: JSON.stringify(action.params).slice(0, 200) });
    try {
      let result: string;
      switch (action.tool) {
        case 'self_update': result = await toolSelfUpdate(action.params, config); break;
        case 'batch_update': result = await toolBatchUpdate(action.params, config); break;
        case 'read_file': result = await toolReadFile(action.params, config); break;
        case 'list_files': result = await toolListFiles(action.params, config); break;
        case 'search_web': result = await toolSearchWeb(action.params); break;
        case 'create_repo': result = await toolCreateRepo(action.params, config); break;
        case 'clone_jarvis': result = await toolCloneJarvis(action.params, config); break;
        case 'deploy_cloudflare': result = await toolDeployCloudflare(action.params, config); break;
        case 'delete_file': result = await toolDeleteFile(action.params, config); break;
        case 'create_branch': result = await toolCreateBranch(action.params, config); break;
        case 'fetch_url': result = await toolFetchUrl(action.params); break;
        case 'save_knowledge':
          result = await toolSaveKnowledge(action.params);
          sendEvent({ type: 'knowledge', category: action.params.category, key: action.params.key, value: action.params.value });
          break;
        case 'create_todo':
          result = `Todo: "${action.params.text}" (${action.params.priority || 'medium'})`;
          sendEvent({ type: 'todo', action: 'add', todo: { id: `todo_${Date.now()}`, text: action.params.text, priority: action.params.priority || 'medium', status: 'pending' } });
          break;
        default:
          throw new Error(`Unknown tool: "${action.tool}". Valid: search_web, read_file, list_files, self_update, batch_update, create_repo, clone_jarvis, deploy_cloudflare, delete_file, create_branch, fetch_url, save_knowledge, create_todo`);
      }
      const duration = Date.now() - startTime;
      results.push({ tool: action.tool, success: true, result, duration });
      sendEvent({ type: 'result', phase: 'result', label: `${action.tool}: OK`, detail: result.length > 500 ? result.slice(0, 500) + '...' : result, duration });
    } catch (err: any) {
      const duration = Date.now() - startTime;
      results.push({ tool: action.tool, success: false, result: err.message, duration });
      sendEvent({ type: 'error', phase: 'error', label: `${action.tool}: FAILED`, detail: err.message });
    }
  }
  return results;
}

export function getConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    githubToken: overrides?.githubToken || process.env.GITHUB_TOKEN || '',
    githubRepo: overrides?.githubRepo || process.env.GITHUB_REPO || 'hatlhatl630-hue/jarvis-ai',
    githubBranch: overrides?.githubBranch || process.env.GITHUB_BRANCH || 'main',
    cfApiToken: overrides?.cfApiToken || process.env.CLOUDFLARE_API_TOKEN || '',
    cfAccountId: overrides?.cfAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || '',
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
