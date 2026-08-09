import { NextRequest } from 'next/server';
import { route, getProviders, getLastProvider, setCloudflareAI, setPersonalModel, routeWithProvider, checkPersonalModel, getPersonalModelInfo } from '@/lib/router';
import { extractActions, extractTodos, executeActions, getConfig, type ActionResult, type TodoBlock } from '@/lib/agent';

// JARVIS v12 — Full Autonomous Self-Replicating Agent

const ARCHITECTURE_CONTEXT = `
## YOUR ARCHITECTURE (THIS IS YOU)
You are a Next.js 16 app running on Cloudflare Workers.
- Language: TypeScript/JavaScript ONLY (NEVER Python, pip, shell, or any non-JS language)
- Framework: Next.js 16 with App Router
- Runtime: Cloudflare Workers (NO filesystem, NO /tmp/, NO Node.js native modules like fs, path, child_process)
- Deployment: OpenNext for Cloudflare, deployed via wrangler
- Worker name: jarvis-v7
- Repo: hatlhatl630-hue/jarvis-v12-clone (branch: main)

YOUR SOURCE FILES (you can read any of these with read_file):
- src/app/page.tsx — Chat UI (React, ~1200 lines)
- src/app/api/chat/route.ts — This file. Chat API with SSE streaming and agent loop (~600 lines)
- src/app/api/ping/route.ts — Health check endpoint
- src/lib/router.ts — Multi-provider AI router with cooldown tracking (~345 lines)
- src/lib/agent.ts — Tool executor with GitHub API, search, clone, deploy (~350 lines)
- src/app/globals.css — Dark theme styles
- src/app/layout.tsx — HTML layout
- package.json — Dependencies
- tsconfig.json — TypeScript config
- wrangler.toml — Cloudflare Worker config
- next.config.ts — Next.js config (output: standalone)

CRITICAL RULES:
- To add a tool: write TypeScript in agent.ts, add case in executeActions switch
- self_update/batch_update push code to GitHub — this is how you modify yourself
- You CANNOT run pip, python, requirements.txt, or write to local filesystem
- All code must be TypeScript/JavaScript compatible with Cloudflare Workers
- When you self_update, content must be the COMPLETE file, never partial`;

const SYSTEM_PROMPT = `You are JARVIS v12, a fully autonomous AI agent that NEVER gives up. You are self-replicating — you can create copies of yourself.
${ARCHITECTURE_CONTEXT}

## WHO YOU ARE
You are not a chatbot. You are an autonomous agent that:
1. Reads and modifies its own source code via GitHub API
2. Searches the web for solutions when stuck
3. Creates complete web applications from scratch
4. Can clone itself into new repositories
5. NEVER stops trying when faced with errors
6. Analyzes failures and tries completely different approaches

## PERSONALITY RULES
- NEVER say "Sure!", "I'd be happy to", "As an AI", "I understand", or any filler
- Start EVERY response with what you are doing RIGHT NOW
- NEVER give a summary of what you WOULD do — actually DO it with [JARVIS_ACTION:...]
- If something fails, analyze the error, search for solutions, and try DIFFERENTLY
- NEVER say the task is complete if there are failures
- NEVER say you cannot do something — find a way

## YOUR TOOLS — Output [JARVIS_ACTION: {"tool":"name","params":{...}}] to use:

1. **search_web** — Search the web (Google via Gemini, Wikipedia, Google Suggest, DuckDuckGo)
   {"tool":"search_web","params":{"query":"specific technical query"}}
   RULES: Include tech terms (typescript, javascript, react, cloudflare workers). For errors, search the EXACT error message. NEVER copy the user's message as-is.

2. **read_file** — Read any file from GitHub
   {"tool":"read_file","params":{"path":"src/lib/agent.ts"}}
   Also supports reading from other repos: {"tool":"read_file","params":{"path":"src/app/page.tsx","repo":"owner/repo-name"}}

3. **list_files** — List directory contents
   {"tool":"list_files","params":{"path":"src/lib"}} or {"tool":"list_files","params":{"path":""}} for root

4. **self_update** — Create/modify a file in GitHub
   {"tool":"self_update","params":{"path":"file.ts","content":"COMPLETE file content here","commitMessage":"description"}}
   CRITICAL: content must be the COMPLETE file, not a diff. Every line.

5. **batch_update** — Push multiple files at once (faster than individual self_update)
   {"tool":"batch_update","params":{"files":[{"path":"a.ts","content":"..."},{"path":"b.ts","content":"..."}],"commitMessage":"..."}}

6. **create_repo** — Create a new GitHub repository
   {"tool":"create_repo","params":{"name":"my-jarvis","description":"JARVIS clone","private":false}}

7. **clone_jarvis** — CREATE A COMPLETE COPY OF YOURSELF in a new repo
   {"tool":"clone_jarvis","params":{"repoName":"jarvis-v12-clone","description":"My JARVIS v12"}}
   This reads ALL your source files and pushes them to a new repo automatically.
   It modifies the worker name and repo references for the new instance.

8. **deploy_cloudflare** — Deploy a GitHub repo to Cloudflare Pages
   {"tool":"deploy_cloudflare","params":{"repoName":"jarvis-v12-clone","projectName":"jarvis-v12-clone"}}
   Creates a CF Pages project connected to the GitHub repo for auto-deploy.

9. **delete_file** — Delete a file from GitHub
   {"tool":"delete_file","params":{"path":"old-file.ts"}}

10. **create_branch** — Create a new git branch
    {"tool":"create_branch","params":{"branch":"feature-xyz","from":"main"}}

11. **fetch_url** — Read content from any public URL
    {"tool":"fetch_url","params":{"url":"https://example.com/api"}}

12. **save_knowledge** — Save information for later
    {"tool":"save_knowledge","params":{"category":"deploy","key":"cf-pages","value":"Use deploy_cloudflare tool"}}

13. **create_todo** — Track a task
    {"tool":"create_todo","params":{"text":"Deploy new JARVIS","priority":"high"}}

## HOW TO CREATE A NEW JARVIS (SELF-REPLICATION RECIPE)
You can create a complete working JARVIS in 2 tool calls:

Step 1: Clone yourself
[JARVIS_ACTION: {"tool":"clone_jarvis","params":{"repoName":"jarvis-v12-new","description":"New JARVIS v12 instance"}}]

Step 2: Deploy it
[JARVIS_ACTION: {"tool":"deploy_cloudflare","params":{"repoName":"jarvis-v12-new","projectName":"jarvis-v12-new"}}]

The clone_jarvis tool does EVERYTHING: creates repo, reads all 11 source files, modifies worker name, pushes them all.
The deploy_cloudflare tool connects it to Cloudflare Pages for auto-deployment.

## ERROR RECOVERY — WHEN THINGS FAIL
This is the most important section. READ IT.

Pattern 1: GitHub 401/403
- Fix: Token is invalid or missing permissions. Ask user to update via: npx wrangler secret put GITHUB_TOKEN
- Or try using a different approach that doesn't need the failing permission

Pattern 2: GitHub 422 SHA conflict
- Fix: The file was modified since you read it. Re-read the file with read_file, get the new SHA, then self_update again.

Pattern 3: GitHub 404
- Fix: File or path doesn't exist. Use list_files first to see what's actually in the directory.

Pattern 4: AI provider timeout/429
- Fix: The router automatically tries the next provider. Just retry or wait.

Pattern 5: "Unknown tool" error
- Fix: Check tool name spelling. Valid: search_web, read_file, list_files, self_update, batch_update, create_repo, clone_jarvis, deploy_cloudflare, delete_file, create_branch, fetch_url, save_knowledge, create_todo

Pattern 6: Cloudflare deploy fails
- Fix: Check CLOUDFLARE_API_TOKEN has Pages permission. Try creating the Pages project manually at dash.cloudflare.com

Pattern 7: batch_update fails on new repo
- Fix: New repos created with auto_init may have conflicts. The clone_jarvis tool handles this by falling back to individual self_update calls.

Pattern 8: Search returns no results
- Fix: Rewrite your search query. Include specific technology names. Instead of "how to add weather" use "cloudflare workers typescript weather api integration openweathermap"

Pattern 9: AI gives up or says "done" when there are failures
- The system will force you to retry. Analyze the error, search for solutions, try a DIFFERENT approach.

## WEB DEVELOPMENT KNOWLEDGE
When building web apps, follow these patterns:

Next.js App Router:
- Pages go in src/app/ (e.g., src/app/page.tsx, src/app/about/page.tsx)
- API routes go in src/app/api/ (e.g., src/app/api/chat/route.ts)
- Layout: src/app/layout.tsx wraps all pages
- Use 'use client' for components with useState, useEffect, event handlers
- Server components (default) can async/await directly

React Patterns:
- useState for local state, useRef for DOM refs
- useEffect for side effects (always with cleanup)
- useCallback for memoized functions
- Map over arrays: {items.map(item => <div key={item.id}>{item.name}</div>)}
- Event handlers: onClick={() => doSomething()}
- Conditional rendering: {condition && <Component />} or {condition ? <A /> : <B />}

TypeScript in Cloudflare Workers:
- NO: fs, path, child_process, os, crypto (Node built-ins)
- YES: fetch, Request, Response, Headers, URL, Blob, ArrayBuffer, TextEncoder/Decoder
- Use AbortSignal.timeout(ms) for all fetch calls
- Use Map, Set, JSON.parse/stringify, Buffer.from(str, 'utf-8').toString('base64')

Tailwind CSS:
- Utility classes: flex, grid, p-4, mx-auto, text-white, bg-gray-900, rounded-lg, shadow-xl
- Dark theme: bg-[#0a0e1a], text-[#e8edf5]
- Responsive: sm:, md:, lg: prefixes
- Animations: transition-all duration-300, hover:scale-105

SSE Streaming (Server-Sent Events):
- Return Response with Content-Type: text/event-stream
- Format: data: {JSON}\n\n (data + space + JSON.stringify + two newlines)
- Event types you can send: providers, thinking, action, result, error, done, todo, knowledge

GitHub API:
- Base: https://api.github.com/repos/{owner}/{repo}
- Auth: Authorization: Bearer {token}
- Get file: GET /contents/{path} → response.content is base64
- Update file: PUT /contents/{path} with {message, content (base64), sha}
- Create file: PUT /contents/{path} with {message, content (base64)} (no sha for new files)
- Batch: POST /git/blobs → POST /git/trees → POST /git/commits → PATCH /git/refs/heads/{branch}
- Create repo: POST https://api.github.com/user/repos with {name, auto_init: true}

Cloudflare Workers Deployment:
- wrangler.toml: name = "worker-name", main = ".open-next/worker.js"
- Deploy command: npx opennextjs-cloudflare build && npx wrangler deploy
- Secrets: npx wrangler secret put SECRET_NAME
- CF API: https://api.cloudflare.com/client/v4/accounts/{id}/pages/projects

## HOW TO BUILD ANY FEATURE
When the user asks you to add a feature:
1. search_web with a specific technical query about that feature
2. read_file src/lib/agent.ts to see the exact tool structure
3. Write the TypeScript code following existing patterns
4. Add case in executeActions switch in agent.ts
5. self_update the complete agent.ts file
6. If the feature needs UI changes, also update src/app/page.tsx via self_update
7. If it fails: READ the error, search_web for the exact error, try differently

## RESPONSE FORMAT
- Use markdown for code and formatting
- After executing tools, briefly state what happened
- If a tool fails, explain the error and IMMEDIATELY try a different approach
- NEVER output [JARVIS_ACTION:] without following through
- NEVER say you are done when there are still failures`;

function sse(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// DEEP THINKING
async function generateDeepThinking(message: string, classification: ReturnType<typeof classifyRequest>, send: (data: any) => void): Promise<void> {
  if (classification.isSimpleMessage) return;

  const thinkStart = Date.now();
  const NL = String.fromCharCode(10);

  if (classification.isCapabilityRequest || classification.isCloneRequest) {
    const isClone = classification.isCloneRequest;
    const thinkPrompt = `You are JARVIS, a Next.js/TypeScript AI agent on Cloudflare Workers.
Analyze this request and create a precise step-by-step plan.

Request: "${message}"

Your tools: search_web, read_file, list_files, self_update, batch_update, create_repo, clone_jarvis, deploy_cloudflare, delete_file, create_branch, fetch_url
Your architecture: Next.js 16, TypeScript, Cloudflare Workers (NO Python, NO filesystem)
${isClone ? `This is a SELF-CLONE request. The clone_jarvis tool handles everything automatically.
Plan: 1) clone_jarvis to create repo with all files  2) deploy_cloudflare to deploy it  3) verify the URL works` : 'Create a numbered plan (5-10 steps). Each step specifies: what file to modify, what to search, what TypeScript code to write.'}

Output a numbered plan. No preamble.`;

    try {
      const result = await routeWithProvider('Gemini', [
        { role: 'system', content: 'Output a numbered plan. Be specific about files, code, APIs. No preamble.' },
        { role: 'user', content: thinkPrompt },
      ], 20000);

      const thinking = result.content;
      const steps = thinking.split(NL).filter((line: string) => /^[0-9]+[.)]/.test(line.trim()));

      if (steps.length > 0) {
        send({ type: 'thinking', phase: 'deep_analysis', label: 'Deep Reasoning', detail: `Planning via ${result.provider}...` });
        for (let i = 0; i < steps.length; i++) {
          const stepText = steps[i].replace(/^\d+[\.\)]\s*/, '').trim();
          if (stepText.length > 0) {
            const phase = i < 2 ? 'deep_analysis' : i < steps.length * 0.5 ? 'strategy' : i < steps.length * 0.8 ? 'knowledge' : 'execution';
            send({ type: 'thinking', phase, label: `Step ${i + 1}/${steps.length}`, detail: stepText });
          }
        }
        send({ type: 'thinking', phase: 'strategy', label: 'Planning complete', detail: `${Date.now() - thinkStart}ms — executing plan`, duration: Date.now() - thinkStart });
        return;
      }
    } catch {}
  }

  const analyses: { phase: string; label: string; detail: string }[] = [];
  if (classification.isCloneRequest) {
    analyses.push(
      { phase: 'deep_analysis', label: 'Self-replication', detail: 'Will use clone_jarvis to copy all source files to new repo, then deploy_cloudflare to deploy.' },
      { phase: 'strategy', label: 'Plan', detail: '1. clone_jarvis creates repo + pushes 11 source files. 2. deploy_cloudflare creates CF Pages project. 3. Verify URL.' },
    );
  } else if (classification.isCapabilityRequest) {
    analyses.push(
      { phase: 'deep_analysis', label: 'Capability request', detail: 'Will read codebase, research implementation, write TypeScript code, push to GitHub.' },
      { phase: 'strategy', label: 'Approach', detail: 'Step 1: Read agent.ts. Step 2: Search web. Step 3: Write code. Step 4: Push via self_update.' },
    );
  } else if (classification.needsAgent) {
    analyses.push(
      { phase: 'deep_analysis', label: 'Analysis', detail: `Agent task: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"` },
    );
  }

  for (const a of analyses) {
    send({ type: 'thinking', phase: a.phase, label: a.label, detail: a.detail });
  }
}

// REQUEST CLASSIFICATION
function classifyRequest(message: string) {
  const lower = message.toLowerCase().trim();
  const words = message.split(/\s+/).filter(w => w.length > 0).length;
  const trimmed = message.trim();

  const greetings = /^(hi|hey|hello|yo|sup|what'?s?\s*up|good\s*(morning|afternoon|evening)|howdy|greetings|hiya|hola)[!?.\s]*$/i;
  const trivialPatterns = [
    /^(thanks?|thank you|thx|ty)[!?.\s]*$/i,
    /^(ok|okay|sure|cool|nice|great|awesome|got it|right|yes|no|maybe)[!?.\s]*$/i,
    /^(lol|lmao|haha|xd)[!?.\s]*$/i,
    /^(bye|goodbye|see you|cya|later|goodnight)[!?.\s]*$/i,
  ];
  const isGreeting = greetings.test(trimmed);
  const isTrivial = trivialPatterns.some(p => p.test(trimmed));
  const isSimpleMessage = (isGreeting || isTrivial || words <= 3) && !/[\[{]/.test(message);

  const isCloneRequest = /clone.*(jarvis|yourself|you|itself)|create.*(new|another|second).*(jarvis|copy|instance)|replicate|self.?repl|make.*(jarvis|yourself).*(again|new|copy)/i.test(lower);

  const capabilityPatterns = [
    /add\s+(a\s+)?(new\s+)?(tool|library|package|module|feature|capability|integration)/i,
    /install\s+/i, /integrate\s+/i, /connect\s+(to\s+)?/i,
    /setup\s+/i, /enable\s+/i, /implement\s+/i,
    /make\s+(me|yourself|you)\s+(able\s+to|capable\s+of)/i,
    /i\s+want\s+(you\s+to\s+)?(have|use|support|add)/i,
    /can\s+you\s+(add|create|build|make)/i,
    /update\s+(your|the|my)\s+(code|system|self)/i,
    /self.?update/i, /improve\s+(yourself|your)/i,
    /give\s+(me|yourself)\s+(the\s+)?ability/i,
    /learn\s+(how\s+)?to/i, /teach\s+yourself/i,
    /add\s+.*\s+(tool|capability|feature)/i,
    /create\s+.*\s+(tool|function|endpoint)/i,
  ];

  const isCapabilityRequest = !isSimpleMessage && !isCloneRequest && capabilityPatterns.some(p => p.test(message));
  const needsAgent = !isSimpleMessage && (
    isCloneRequest || isCapabilityRequest ||
    /search|find|look up|update|modify|create|delete|push|commit|read\s+file|list\s+file/i.test(lower) ||
    words > 15
  );

  return { isCapabilityRequest, isCloneRequest, needsAgent, isSimpleMessage };
}

// AUTO-READ CODEBASE CONTEXT
async function injectCodebaseContext(messages: any[], send: (data: any) => void, config: { githubToken: string }): Promise<any[]> {
  send({ type: 'thinking', phase: 'knowledge', label: 'Reading codebase', detail: 'Loading agent.ts...' });

  try {
    const url = `https://api.github.com/repos/hatlhatl630-hue/jarvis-v12-clone/contents/src/lib/agent.ts`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.githubToken}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JARVIS-AI/12.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const NL = String.fromCharCode(10);
      const preview = content.length > 4000 ? content.slice(0, 4000) + NL + '... [truncated, full file is ' + content.length + ' chars]' : content;
      send({ type: 'thinking', phase: 'knowledge', label: 'Codebase loaded', detail: `agent.ts: ${content.split(NL).length} lines` });
      return [
        messages[0],
        { role: 'user', content: `## CURRENT CODEBASE CONTEXT\nsrc/lib/agent.ts:\n${'```'}typescript\n${preview}\n${'```'}\n\nNew tools must follow this pattern. Write the complete function, add case in executeActions switch.` },
        messages[1],
      ];
    }
  } catch (e: any) {
    send({ type: 'thinking', phase: 'knowledge', label: 'Codebase read failed', detail: e.message });
  }

  return messages;
}

// MAIN ROUTE
export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: any) => controller.enqueue(encoder.encode(sse(data)));

        try {
          const requestStartTime = Date.now();
          send({ type: 'providers', providers: getProviders() });

          // CF env
          let cfEnv: any = {};
          try {
            const { getCloudflareContext } = await import('@opennextjs/cloudflare');
            const ctx = await getCloudflareContext({ async: true });
            cfEnv = ctx.env || {};
            if (cfEnv.AI) setCloudflareAI(cfEnv.AI);
          } catch {}

          // Personal Model
          const personalUrl = cfEnv.PERSONAL_MODEL_URL || process.env.PERSONAL_MODEL_URL || '';
          const personalModel = cfEnv.PERSONAL_MODEL_NAME || process.env.PERSONAL_MODEL_NAME || '';
          if (personalUrl) {
            setPersonalModel(personalUrl, personalModel || undefined);
            send({ type: 'thinking', phase: 'verification', label: 'Personal Model', detail: `Connected to ${personalModel || 'qwen2.5:14b'} at ${personalUrl.slice(0, 40)}...` });
          }

          // Provider keys
          if (cfEnv.CEREBRAS_API_KEY || cfEnv.SAMBANOVA_API_KEY) {
            const { setProviderKeys } = await import('@/lib/router');
            setProviderKeys({ cerebras: cfEnv.CEREBRAS_API_KEY || '', sambanova: cfEnv.SAMBANOVA_API_KEY || '' });
          }

          // Agent config
          const agentConfig = getConfig({
            githubToken: cfEnv.GITHUB_TOKEN || process.env.GITHUB_TOKEN || '',
            githubRepo: cfEnv.GITHUB_REPO || process.env.GITHUB_REPO || 'hatlhatl630-hue/jarvis-v12-clone',
            githubBranch: cfEnv.GITHUB_BRANCH || process.env.GITHUB_BRANCH || 'main',
            cfApiToken: cfEnv.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '',
            cfAccountId: cfEnv.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
          });

          if (!agentConfig.githubToken) {
            send({ type: 'error', phase: 'error', label: 'Config error', detail: 'GITHUB_TOKEN not found. Run: npx wrangler secret put GITHUB_TOKEN' });
          } else {
            send({ type: 'thinking', phase: 'verification', label: 'Config OK', detail: `GitHub: ${agentConfig.githubToken.slice(0, 6)}...${agentConfig.githubToken.slice(-4)}, repo: ${agentConfig.githubRepo}${personalUrl ? ' + Personal Model' : ''}` });
          }

          const classification = classifyRequest(message);

          if (!classification.isSimpleMessage) {
            send({
              type: 'thinking', phase: 'deep_analysis',
              label: classification.isCloneRequest ? 'Self-replication request' : classification.isCapabilityRequest ? 'Capability request' : classification.needsAgent ? 'Agent task' : 'Processing',
              detail: classification.isCloneRequest ? 'Will clone JARVIS to new repo and deploy' : 'Will use tools as needed',
            });
          }
          await generateDeepThinking(message, classification, send);

          // Agent loop
          const maxRounds = (classification.isCloneRequest || classification.isCapabilityRequest) ? 20 : classification.needsAgent ? 8 : 2;

          let messages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: message },
          ];

          if (classification.isCapabilityRequest) {
            messages = await injectCodebaseContext(messages, send, agentConfig);
          }

          let finalReply = '';
          let totalActionsExecuted = 0;
          let totalFailures = 0;
          let totalSuccesses = 0;
          let allResultsSummary = '';
          let consecutiveNoActions = 0;

          for (let round = 1; round <= maxRounds; round++) {
            const roundLabel = `Round ${round}/${maxRounds} — ${totalActionsExecuted} actions (${totalSuccesses} ok, ${totalFailures} fail)`;
            send({ type: 'thinking', phase: 'execution', label: roundLabel, detail: 'Calling AI...' });

            let reply: string;
            try {
              const result = await route(messages);
              reply = result.content;
              send({ type: 'thinking', phase: 'execution', label: 'Response received', detail: `${result.provider} (${result.model})` });
            } catch (e: any) {
              send({ type: 'error', phase: 'error', label: 'Provider error', detail: e.message });

              if (totalActionsExecuted > 0) {
                send({ type: 'done', reply: buildActionSummary(allResultsSummary, totalActionsExecuted, totalSuccesses, totalFailures) + '\n\n**Note:** AI providers exhausted. Actions above were completed. Ask again to continue.', provider: '', thinkingTime: Date.now() - requestStartTime });
                return;
              }

              if (round < maxRounds) {
                send({ type: 'thinking', phase: 'execution', label: 'Retrying...', detail: `Round ${round} failed, waiting 3s...` });
                await new Promise(r => setTimeout(r, 3000));
                continue;
              }
              send({ type: 'done', reply: 'All AI providers temporarily unavailable. Try again in 30 seconds.', provider: '', thinkingTime: Date.now() - requestStartTime });
              return;
            }

            // Extract todos
            const { cleanText: noTodos, todos } = extractTodos(reply);
            for (const todo of todos) {
              send({ type: 'todo', action: 'add', todo: { id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text: todo.text, priority: todo.priority, status: 'pending' } });
            }

            // Extract actions
            const { cleanText, actions } = extractActions(noTodos);

            if (actions.length === 0) {
              finalReply = cleanText.trim() || reply.trim();
              consecutiveNoActions++;

              // NEVER GIVE UP for clone/capability requests
              if ((classification.isCloneRequest || classification.isCapabilityRequest) && round < maxRounds) {
                const isFakingDone = /i (am|have) done|completed|finished|here.*(is|are) (the|my) (next )?step/i.test(finalReply);

                if (isFakingDone && totalFailures > 0) {
                  send({ type: 'thinking', phase: 'execution', label: 'Fake completion detected', detail: 'Forcing retry with error analysis.' });
                  messages = [
                    { role: 'system', content: SYSTEM_PROMPT + `\n\n## TASK NOT COMPLETE\nYou had ${totalFailures} failures. You CANNOT say done.\n\nFailures:\n${allResultsSummary.split('[FAIL]').slice(-3).join('[FAIL]')}\n\nYou MUST: 1) Analyze WHY 2) Search web for solutions 3) Try DIFFERENT approach 4) Output [JARVIS_ACTION:...]` },
                    { role: 'user', content: message },
                    { role: 'assistant', content: reply },
                    { role: 'user', content: 'You are NOT done. Failures exist. Analyze errors and try differently. Output [JARVIS_ACTION:...] NOW.' },
                  ];
                  consecutiveNoActions = 0;
                  continue;
                }

                const pushMsg = consecutiveNoActions <= 2
                  ? 'Use your tools. Output [JARVIS_ACTION:...] with your next action.'
                  : 'OUTPUT [JARVIS_ACTION:{"tool":"...","params":{...}}] RIGHT NOW. No more text.';

                messages = [
                  { role: 'system', content: SYSTEM_PROMPT + `\n\n## TASK IN PROGRESS\nOriginal: ${message}\nActions: ${totalActionsExecuted} (${totalSuccesses} ok, ${totalFailures} fail)\n\nChoose the most useful next action:\n- If you haven't searched: search_web\n- If you haven't read agent.ts: read_file it\n- If you have code to push: self_update or batch_update\n- If cloning: use clone_jarvis tool\n- If deploying: use deploy_cloudflare tool\n- If something failed: search for the error and try differently\n\n${pushMsg}` },
                  { role: 'user', content: message },
                  ...(reply ? [{ role: 'assistant', content: reply }] : []),
                  { role: 'user', content: pushMsg },
                ];

                if (consecutiveNoActions >= 4) consecutiveNoActions = 0;
                continue;
              }

              if (!classification.isCloneRequest && !classification.isCapabilityRequest) break;
              if (consecutiveNoActions >= 3) break;
              continue;
            }

            // EXECUTE ACTIONS
            consecutiveNoActions = 0;
            send({ type: 'thinking', phase: 'action', label: `Executing ${actions.length} tool${actions.length > 1 ? 's' : ''}`, detail: actions.map(a => `${a.tool}(${JSON.stringify(a.params).slice(0, 120)})`).join(' -> ') });

            const results: ActionResult[] = await executeActions(actions, agentConfig, send);
            totalActionsExecuted += actions.length;

            const roundSuccesses = results.filter(r => r.success).length;
            const roundFailures = results.filter(r => !r.success).length;
            totalSuccesses += roundSuccesses;
            totalFailures += roundFailures;

            const roundSummary = results.map(r => {
              const icon = r.success ? 'OK' : 'FAIL';
              const preview = r.result.length > 1000 ? r.result.slice(0, 1000) + '...[truncated]' : r.result;
              return `[${icon}] ${r.tool} (${r.duration}ms):\n${preview}`;
            }).join('\n\n');

            allResultsSummary += `\n--- Round ${round} ---\n${roundSummary}\n`;
            send({ type: 'thinking', phase: 'result', label: `Round ${round}: ${roundSuccesses} OK, ${roundFailures} FAIL`, detail: `Total: ${totalActionsExecuted} (${totalSuccesses} ok, ${totalFailures} fail)` });

            // Build next round context
            const NL = String.fromCharCode(10);
            let nextSystemPrompt = SYSTEM_PROMPT;

            if (roundFailures > 0) {
              const failDetails = results.filter(r => !r.success).map(r => `${r.tool}: ${r.result}`).join(NL);
              nextSystemPrompt += `\n\n## ERRORS — YOU MUST FIX THESE\n${failDetails}\n\nError recovery rules:\n- GitHub 401: Token invalid. Ask user to update.\n- GitHub 404: File/path not found. Use list_files first.\n- GitHub 422 SHA: File was modified. Re-read it, then update again.\n- "Unknown tool": Fix tool name. Valid: search_web, read_file, list_files, self_update, batch_update, create_repo, clone_jarvis, deploy_cloudflare, delete_file, create_branch, fetch_url, save_knowledge, create_todo\n- Search no results: Rephrase with specific tech terms.\n- Network timeout: Retry or use alternative.\n- TRY A DIFFERENT APPROACH IF SAME THING FAILED\n- Search the web for the EXACT error message\n- DO NOT say done when there are errors`;
            }

            if ((classification.isCloneRequest || classification.isCapabilityRequest) && round < maxRounds) {
              nextSystemPrompt += `\n\n## STATUS (Round ${round}/${maxRounds})\nOriginal: ${message.slice(0, 200)}\nActions: ${totalActionsExecuted} (${totalSuccesses} ok, ${totalFailures} fail)\n\nIf COMPLETELY done (all code pushed, no errors): say "TASK COMPLETE" and summarize.\nIf failures or unfinished: continue with [JARVIS_ACTION:...]`;
            } else {
              nextSystemPrompt += '\n\nSummarize the results.';
            }

            messages = [
              { role: 'system', content: nextSystemPrompt },
              { role: 'user', content: message },
              { role: 'assistant', content: reply },
              { role: 'user', content: `Tools executed. ${roundFailures > 0 ? 'FAILURES exist — analyze errors and try different approach. ' : ''}${(classification.isCloneRequest || classification.isCapabilityRequest) && round < maxRounds ? 'Continue if not complete.' : 'Summarize.'}` },
            ];

            if (!classification.isCloneRequest && !classification.isCapabilityRequest && roundSuccesses === actions.length && round >= 2) {
              try {
                const result = await route([
                  { role: 'system', content: SYSTEM_PROMPT + '\n\nSummarize concisely. No [JARVIS_ACTION:] blocks.' },
                  { role: 'user', content: message },
                  { role: 'assistant', content: reply },
                  { role: 'user', content: `Results:\n${roundSummary}\n\nSummarize.` },
                ]);
                const { cleanText: fc1 } = extractActions(result.content);
                const { cleanText: fc2 } = extractTodos(fc1);
                finalReply = fc2.trim() || result.content.trim();
              } catch { finalReply = roundSummary; }
              break;
            }

            if ((classification.isCloneRequest || classification.isCapabilityRequest) && totalFailures === 0 && roundSuccesses > 0) {
              const replyLower = reply.toLowerCase();
              if (/task complete|i am done|i have (successfully )?(added|created|implemented|updated|pushed|fixed|cloned|deployed)/i.test(replyLower)) {
                finalReply = cleanText.trim() || reply.trim();
                break;
              }
            }
          }

          if (!finalReply || finalReply === 'Processing complete.') {
            if (totalActionsExecuted > 0 && allResultsSummary) {
              finalReply = buildActionSummary(allResultsSummary, totalActionsExecuted, totalSuccesses, totalFailures);
            } else if (!finalReply) {
              finalReply = 'Processing complete.';
            }
          }

          const totalElapsed = Date.now() - requestStartTime;
          send({ type: 'thinking', phase: 'verification', label: 'Done', detail: `${totalElapsed}ms, ${totalActionsExecuted} tool calls (${totalSuccesses} ok, ${totalFailures} fail)`, duration: totalElapsed });
          send({ type: 'done', reply: finalReply, provider: getLastProvider(), thinkingTime: totalElapsed });
        } catch (error: any) {
          send({ type: 'error', phase: 'error', label: 'Error', detail: error.message });
          send({ type: 'done', reply: `Error: ${error.message}`, provider: '' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

function buildActionSummary(allResults: string, totalActions: number, successes: number, failures: number): string {
  const lines = allResults.split('\n').filter(l => l.trim());
  let summary = `**Action Report:** ${successes} succeeded, ${failures} failed (${totalActions} total)\n\n`;
  for (const line of lines) {
    if (line.startsWith('---')) continue;
    if (line.includes('[OK]')) {
      const toolMatch = line.match(/\[OK\] (\w+)/);
      const toolName = toolMatch ? toolMatch[1] : 'tool';
      const idx = lines.indexOf(line);
      const resultLine = lines[idx + 1];
      if (resultLine && !resultLine.startsWith('[') && !resultLine.startsWith('---')) {
        summary += `- **${toolName}**: ${resultLine.slice(0, 300)}\n`;
      }
    } else if (line.includes('[FAIL]')) {
      const toolMatch = line.match(/\[FAIL\] (\w+)/);
      const toolName = toolMatch ? toolMatch[1] : 'tool';
      const idx = lines.indexOf(line);
      const resultLine = lines[idx + 1];
      if (resultLine && !resultLine.startsWith('[') && !resultLine.startsWith('---')) {
        summary += `- **${toolName}** (failed): ${resultLine.slice(0, 250)}\n`;
      }
    }
  }
  return summary;
}