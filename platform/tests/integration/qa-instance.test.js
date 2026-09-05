import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDb } from '../../scripts/lib/qa-instance.mjs';

test('disposable QA seeds the department manager identity after sectors without changing fixture ownership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sanad-qa-identity-'));
  process.env.SANAD_DB = join(dir, 'test.db');
  let db;
  try {
    buildDb(process.env.SANAD_DB);
    db = await import('../../src/core/db/index.js');
    const { initRbac } = await import('../../src/core/rbac/index.js');
    await initRbac();
    const { resolveUserFromSession } = await import('../../src/core/http/context.js');
    const { canReadClose } = await import('../../src/modules/team/access.js');
    const account = await db.get("SELECT id, employee_id FROM app_user WHERE username='demo.deptmgr'");
    const emp = await db.get('SELECT * FROM employee WHERE id=?', [account.employee_id]);
    assert.ok(emp?.department_id);
    assert.equal(emp.user_id, account.id);
    assert.equal((await db.get('SELECT manager_user_id FROM department WHERE id=?', [emp.department_id])).manager_user_id, account.id);
    const user = await resolveUserFromSession({ user_id: account.id });
    assert.equal(canReadClose(user, 'SOLUTIONS'), true);
    assert.equal(canReadClose(user, 'CONSULTING'), false);
    const originalOwner = await db.get("SELECT u.username FROM opportunity o JOIN app_user u ON u.id=o.owner_user_id WHERE o.id='FX-OPP-2'");
    assert.equal(originalOwner.username, 'demo.bd');
  } finally {
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
