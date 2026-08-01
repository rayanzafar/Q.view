// نطاق «الإدارة» كان يمرّ فارغاً: الشرط `!target.department_id || …` يعني أن أي هدف لا يحمل
// عمود الإدارة يجتاز الفحص — وأكثر الصفوف كذلك. فكان مدير إدارة في قطاع يجتاز فحصاً على هدف
// يخصّ قطاعاً آخر. هذه الاختبارات تثبت أن التسريب العابر للقطاعات مغلق، وتوثّق ما بقي مفتوحاً.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeReaches } from '../../src/core/rbac/index.js';

const deptMgr = { id: 'u1', sector_id: 'CONSULTING', department_id: 'dep_pmo' };

test('هدف في قطاع آخر بلا إدارة: مرفوض — هذا هو التسريب الذي كان قائماً', () => {
  assert.equal(scopeReaches(deptMgr, 'department', { sector_id: 'SOLUTIONS' }), false);
  assert.equal(
    scopeReaches(deptMgr, 'department', { sector_id: 'SOLUTIONS', assignee_user_id: 'u9' }),
    false,
    'نفس شكل الهدف الذي تمرّره خدمة المهام عند إسناد مهمة لشخص آخر',
  );
});

test('هدف يحمل إدارة: يُقارَن بإدارة المستخدم لا أكثر', () => {
  assert.equal(scopeReaches(deptMgr, 'department', { department_id: 'dep_pmo' }), true);
  assert.equal(scopeReaches(deptMgr, 'department', { department_id: 'dep_ai' }), false);
  // الإدارة تحسم حتى لو ذكر الهدف قطاع المستخدم نفسه
  assert.equal(scopeReaches(deptMgr, 'department', { department_id: 'dep_ai', sector_id: 'CONSULTING' }), false);
});

test('هدف في القطاع نفسه: يُقبل', () => {
  assert.equal(scopeReaches(deptMgr, 'department', { sector_id: 'CONSULTING' }), true);
});

test('حدّ معروف وموثَّق: هدف بلا إدارة وبلا قطاع لا يزال يمرّ', () => {
  // ليس سهواً: الإغلاق الكامل يحرم مدير الإدارة من صفوف مشروعة لا تحمل عمود إدارة (المهام).
  // الحسم الصحيح أن يحمل كل صف إدارته — بدأته الموجة 007 على المشروع والفرصة والتسكين.
  assert.equal(scopeReaches(deptMgr, 'department', { id: 'x' }), true);
});

test('مستخدم بلا قطاع لا ينكسر الفحص عليه', () => {
  const noSector = { id: 'u2', department_id: 'dep_pmo' };
  assert.equal(scopeReaches(noSector, 'department', { sector_id: 'SOLUTIONS' }), true, 'لا نفي ممكن بلا قطاع للمستخدم');
  assert.equal(scopeReaches(noSector, 'department', { department_id: 'dep_ai' }), false);
});
