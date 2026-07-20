#!/usr/bin/env node
// PostToolUse hook (Edit|Write): syntax-check edited JS and mark the tree dirty for the Stop hook.
// Exit 2 => the error text on stderr is fed back to Claude as blocking feedback.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let input = '';
try { input = await new Promise((res) => { let b = ''; process.stdin.on('data', (c) => b += c); process.stdin.on('end', () => res(b)); }); } catch { /* ignore */ }
let file = '';
try { file = JSON.parse(input || '{}')?.tool_input?.file_path || ''; } catch { /* ignore */ }
if (!file || !existsSync(file)) process.exit(0);

// mark "edited since last test run" for the Stop hook (cheap heartbeat)
try {
  const marker = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude/.edited');
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, new Date().toISOString());
} catch { /* non-fatal */ }

if (/\.(js|mjs|cjs)$/.test(file)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    process.stderr.write(`SYNTAX ERROR in ${file} — fix before continuing:\n${e.stderr?.toString().slice(0, 2000) || e.message}`);
    process.exit(2);
  }
}
process.exit(0);
