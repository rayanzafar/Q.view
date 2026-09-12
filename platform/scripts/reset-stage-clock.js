// ── تصفير عدّاد المراحل: اليوم هو نقطة الصفر ──────────────────────────────────
//
// «لا تحطّ أي فرصة متوقّفة، وأيضاً صفّر العدّاد تبع الفرص بحيث كأنه نقطة الصفر اليوم — وأي شي
// ينضاف راح يبدأ من اللي انضاف فيه، بس أي شي موجود الحين خلّيه صفر ويبدأ العدّاد من اليوم»
// — بلسان المالك.
//
// والسبب أن العدّاد يقرأ `stage_changed_at`، والفرص المستوردة تحمل تواريخ النظام القديم — بعضها
// أقدم من سنة. فتُقرأ كلها «متوقّفة» في اليوم الأول من استعمال المنصة: علامةٌ حمراء على مئةٍ
// وأربعٍ وثلاثين فرصة تعني «لا شيء متوقّف» عملياً، لأن ما يشتعل دائماً لا يُنظر إليه.
//
// وتصفيرُ الساعة ليس محو تاريخ: مسار المراحل محفوظ في `opportunity_stage_history`، وتاريخ
// الإنشاء في مكانه. الذي يُعاد ضبطه هو **متى بدأنا نعدّ** — والعدّ يبدأ يوم صارت المنصة هي
// مكان العمل، لا يوم كان الصفّ في نظامٍ آخر.
//
// ── يُشغَّل مرةً واحدة ──
// الطابع يمنع إعادة التصفير مع كل إقلاع — فلو أُعيد لأُلغيَ كلُّ توقّفٍ حقيقي تراكم منذ التصفير
// الأول، ولصار العدّاد بلا معنى إلى الأبد.
//
// والطابع في `schema_migration` لا في جدول إعدادات جديد: هو سجلّ «ما جرى مرةً واحدة» القائم في
// المنصة، وإضافةُ جدولٍ ثانٍ لنفس الغرض تُنشئ موضعين يُسأل عنهما «هل نُفِّذت هذه الخطوة».
//
// ويُشغَّل من الإقلاع لا من جهاز التطوير: منفذ القاعدة غير مبلوغ من خارج شبكة النشر (نفس قيد
// `backfill-legacy-activity` المكتوب في `scripts/boot.sh`).
import { all, get, run, update } from '../src/core/db/index.js';
import { nowIso } from '../src/core/util/ids.js';

const FLAG = 'op:reset-stage-clock';

export async function resetStageClock({ force = false } = {}) {
  const today = nowIso();
  const done = await get('SELECT applied_at FROM schema_migration WHERE version = ?', [FLAG]);
  if (done?.applied_at && !force) return { skipped: true, at: done.applied_at, updated: 0 };

  // الفرص المفتوحة وحدها: المكسوبة والمفقودة لا يُقاس عليها توقّف أصلاً (`ROT_THRESHOLDS`
  // لا تشملهما)، فتغييرُ ساعتها عبثٌ يمسّ بيانات بلا أثرٍ على شاشة.
  const rows = await all(
    `SELECT o.id FROM opportunity o LEFT JOIN stage s ON s.id = o.stage_id
      WHERE o.deleted_at IS NULL
        AND COALESCE(s.is_won, 0) = 0 AND COALESCE(s.is_lost, 0) = 0`);
  for (const r of rows) await update('opportunity', r.id, { stage_changed_at: today });

  await run(
    `INSERT INTO schema_migration (version, applied_at) VALUES (?,?)
     ON CONFLICT (version) DO UPDATE SET applied_at = excluded.applied_at`, [FLAG, today]);
  return { skipped: false, at: today, updated: rows.length };
}

// تشغيلٌ مباشر من سطر الأوامر (الإقلاع) — والاستيراد لا يُشغّل شيئاً.
if (process.argv[1] && process.argv[1].endsWith('reset-stage-clock.js')) {
  const r = await resetStageClock({ force: process.argv.includes('--force') });
  console.log(r.skipped
    ? `عدّاد المراحل مُصفَّر مسبقاً في ${String(r.at).slice(0, 10)} — لا تغيير`
    : `صُفِّر عدّاد المراحل لـ${r.updated} فرصة مفتوحة — نقطة الصفر ${String(r.at).slice(0, 10)}`);
}
