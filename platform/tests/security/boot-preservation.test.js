// Exercise the actual boot shell with a recording Node stub: no database is opened.
// Even a persisted demo flag must never schedule a historical repair or fixture write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../..', import.meta.url).pathname;
const expected = [
  '--experimental-sqlite scripts/migrate.js',
  '--experimental-sqlite scripts/seed-rbac.js',
  '--experimental-sqlite scripts/seed-admin.js',
  '--experimental-sqlite src/server.js',
];

for (const flag of [undefined, '0', 'false', '1', 'true']) {
  test(`boot preserves business data with demo switch ${flag ?? 'unset'}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'sanad-boot-preservation-'));
    try {
      const log = join(dir, 'calls');
      writeFileSync(join(dir, 'node'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SANAD_BOOT_TEST_LOG"\n', { mode: 0o755 });
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, SANAD_BOOT_TEST_LOG: log };
      if (flag === undefined) delete env.SANAD_SEED_DEMO;
      else env.SANAD_SEED_DEMO = flag;
      const result = spawnSync('/bin/sh', ['scripts/boot.sh'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), expected,
        'Normal boot may invoke only schema migration, security bootstrap, and server');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
