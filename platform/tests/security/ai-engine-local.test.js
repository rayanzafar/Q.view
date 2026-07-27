// المحرّك محلي بقرار المالك — **ومفتاحٌ شارد لا يقلب المنتج**.
//
// العطل الذي يحرسه هذا الملف: كان `aiMode()` يعود بمزوّد خارجي لمجرد وجود متغيّر بيئة يحمل
// مفتاحاً. فمتغيّر واحد منسوخ من بيئة أخرى — أو مضاف لأداة ثالثة على الخادم نفسه — كان يكفي
// ليتحوّل المساعد من محرّك حتمي داخل المنصة إلى نداءٍ خارجي يُرسل معطيات الشركة، بلا قرار من
// أحد وبلا أثر في أي شاشة. المفتاح قرينة، والقرار إعلان نية صريح: AI_ENGINE.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'sanad-ai-engine-'));
process.env.SANAD_DB = join(dir, 't.db');
// مفتاح موجود فعلاً، وبلا إعلان نية: هذه هي الحالة الخطرة بالضبط.
process.env.OPENAI_API_KEY = 'sk-test-stray-key-must-not-flip-the-product';
delete process.env.AI_ENGINE;
delete process.env.ANTHROPIC_API_KEY;

const ROOT = new URL('../..', import.meta.url).pathname;
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/migrate.js')], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, ['--experimental-sqlite', join(ROOT, 'scripts/seed-rbac.js')], { env: process.env, stdio: 'ignore' });

const { insert, close } = await import('../../src/core/db/index.js');
const { initRbac } = await import('../../src/core/rbac/index.js');
await initRbac();
const provider = await import('../../src/core/ai/provider.js');
const { ask, aiStatus } = await import('../../src/core/ai/assistant.js');

const T = '2026-07-01T00:00:00Z';
const realFetch = globalThis.fetch;
let calls = [];

before(async () => {
  await insert('sector', { id: 'S1', name_ar: 'قطاع الاختبار', active: 1, sort_order: 1, created_at: T });
  await insert('project', { id: 'p_1', name_ar: 'منصة الفحص المحلي', sector_id: 'S1', status: 'IN_PROGRESS',
    rag: 'GREEN', progress_pct: 20, contract_value_halalas: 1000, created_at: T });
  globalThis.fetch = async (...a) => { calls.push(a); throw new Error('no outbound call is allowed in the local engine'); };
});
after(async () => { globalThis.fetch = realFetch; await close(); rmSync(dir, { recursive: true, force: true }); });

test('مفتاح موجود بلا إعلان نية ⟵ المحرّك يبقى محلياً', () => {
  assert.equal(provider.aiEngine(), 'local');
  assert.equal(provider.aiMode(), 'local');
  assert.equal(provider.keyPresentWithoutOptIn(), true, 'الحالة معروفة ومُعلَنة لا مخفية');
  const s = aiStatus({ id: 'u1', role_id: 'admin', scope: 'company' });
  assert.equal(s.mode, 'local');
  assert.equal(s.modeLabel, 'محلي');
  assert.equal(s.configured, false);
});

test('ولا مكالمة خارجية واحدة تخرج من المنصة', async () => {
  calls = [];
  const user = { id: 'u1', role_id: 'admin', scope: 'company', projectIds: new Set(), teamIds: new Set() };
  const r = await ask({ user, ip: '127.0.0.1' }, 'لخّص حالة مشروع منصة الفحص المحلي');
  assert.match(r.reply, /منصة الفحص المحلي/);
  assert.equal(calls.length, 0, 'خرجت مكالمة إلى الخارج والمحرّك محلي');
});

test('نصّ الحالة لا يسمّي متغيّر بيئة ولا يصف المنتج بأنه ناقص', () => {
  const s = aiStatus({ id: 'u1', role_id: 'admin', scope: 'company' });
  assert.ok(!/API|KEY|ANTHROPIC|OPENAI/i.test(s.note), 'النص يذكر إعداداً تقنياً: ' + s.note);
  assert.match(s.note, /داخل المنصة/);
});

test('الإعلان الصريح وحده يفتح الباب — ومع مهلة زمنية على النداء', async () => {
  process.env.AI_ENGINE = 'provider';
  try {
    assert.equal(provider.aiMode(), 'openai', 'بإعلان النية والمفتاح معاً يُفتح المزوّد');
    calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    await provider.complete({ system: 'a', user: 'b' });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].init.signal, 'النداء بلا مهلة يعلّق الطلب إلى الأبد');
    assert.equal(typeof calls[0].init.signal.aborted, 'boolean');
  } finally {
    delete process.env.AI_ENGINE;
    globalThis.fetch = async () => { throw new Error('blocked'); };
  }
  assert.equal(provider.aiMode(), 'local', 'وبرفع الإعلان يعود محلياً فوراً');
});

test('المحرّك المحلي لا ينادي المزوّد أصلاً', async () => {
  await assert.rejects(() => provider.complete({ system: 'a', user: 'b' }), /local_engine/);
});
