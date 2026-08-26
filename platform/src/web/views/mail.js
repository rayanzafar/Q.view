// مركز البريد — عرض صادرات المنصة (وضع المعاينة يكتب الرسالة إلى صندوق معاينة بدل إرسالها فعلياً)،
// طابور الإرسال وسجلّه، وحالة قناة الإرسال. إتاحته لمدير النظام ومكتب الرئيس فقط (nav.js).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layout, card, pill } from '../layout.js';
import { all } from '../../core/db/index.js';
import { config, ROOT } from '../../core/config.js';
import { mailEventLabel, mailStatusLabel, mailStatusTone } from '../i18n/glossary.js';
import { esc } from './_shared.js';
import { loadApprovalMailRules } from '../../modules/workflow/approval-notify.js';

export async function mailPage(user, opts = {}) {
  const dir = resolve(ROOT, 'data/outbox');
  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t).slice(0, 30);
  } catch { files = []; }
  const queue = await all(`SELECT id, subject, status, attempts, last_error, created_at, sent_at, to_json
      FROM email_queue ORDER BY created_at DESC LIMIT 30`);
  const logs = await all(`SELECT l.event, l.detail, l.at, q.subject FROM email_log l
      LEFT JOIN email_queue q ON q.id = l.queue_id ORDER BY l.at DESC LIMIT 30`);
  const smtpOn = config.mailTransport === 'smtp';

  // «مفعّل» وحدها لا تكفي — المُشغّل يحتاج أن يعرف إلى مَن يصل البريد فعلاً. قائمةُ سماحٍ
  // مضبوطة تعني أن رسائل الآخرين تُحجب بصمت، وإخفاء ذلك يجعل الشاشة تَعِد بما لا يحدث.
  const allow = config.mailAllowlist;
  const openToAll = config.mailUnrestricted;
  const scopeText = openToAll
    ? 'الإرسال مفتوح لكل العناوين — هذه إعدادات التشغيل الحقيقي.'
    : allow.length
      ? `الإرسال مقصورٌ على ${allow.length} عنواناً مسموحاً به؛ ما عداها يُحجب ويُسجَّل «حُجبت».`
      : 'لا يوجد عنوان مسموح به بعد — كل رسالة ستُحجب. أضِف عناوين التجربة أولاً.';
  const scopeTone = openToAll ? 'green' : allow.length ? 'blue' : 'red';

  // ── ومِن أي عنوان يخرج البريد؟ ──
  // كانت الشاشة تقول «مفعّل» و«إلى مَن» ولا تقول **مِن مَن** — وهو نصف الحقيقة الغائب. وعنوان
  // المُرسِل هو ما يقرّر إن كانت الرسالة تصل أصلاً: نطاقٌ غير موثَّق لدى المزوّد يعني رفضاً
  // أو حجزاً في البريد المزعج، ونطاقُ تجربة يعني وصولاً لصاحب الحساب وحده مهما طالت قائمة
  // السماح. وكِلا الحالتين تبدو من هنا «مفعّلة وتعمل»، فيُطلَق الشيء وهو معطَّل عملياً.
  const from = String(config.smtp.from || '').trim();
  const fromAddr = (from.match(/<([^>]+)>/)?.[1] || from).trim();
  const fromDomain = fromAddr.includes('@') ? fromAddr.split('@').pop().toLowerCase() : '';
  // نطاقات التجربة التي يمنحها مزوّدو الإرسال: تعمل فوراً لكنها **لا تصل إلا صاحب الحساب**.
  const SANDBOX_DOMAINS = ['resend.dev', 'example.com', 'localhost'];
  const sandbox = SANDBOX_DOMAINS.some((d) => fromDomain === d || fromDomain.endsWith('.' + d));
  const fromTone = !fromAddr ? 'red' : sandbox ? 'amber' : 'blue';
  const fromNote = !fromAddr
    ? 'لم يُضبط عنوان المُرسِل — لن تخرج أي رسالة حتى يُضبط بعنوانٍ على نطاقٍ موثَّق لدى مزوّد الإرسال.'
    : sandbox
      ? 'هذا نطاق تجربة من مزوّد الإرسال: الرسائل لا تصل إلا صاحب حساب المزوّد نفسه، مهما أُضيف إلى قائمة السماح. وثِّق نطاق الشركة لدى المزوّد ثم اضبط المُرسِل عليه.'
      : '';

  // حالة القناة الاحتياطية تُقرأ من إعدادها لا من محاولةِ إرسال — الشاشة تصف الجاهزية.
  const fb = config.smtpFallback || {};
  const fbReady = !!(fb.host && fb.user && fb.pass && fb.from);
  const fbFrom = String(fb.from || '').trim();
  const fbAddr = (fbFrom.match(/<([^>]+)>/)?.[1] || fbFrom).trim();
  const canTest = user?.role_id === 'admin';

  const chan = card(`<div style="padding:.85rem 1rem;display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">
    <div style="font-weight:800;font-size:13.5px">قناة الإرسال</div>
    ${smtpOn ? pill('بريد حقيقي مفعّل', 'green') : pill('وضع المعاينة — لا يُرسل بريد حقيقي', 'amber')}
    ${smtpOn ? pill(openToAll ? 'مفتوح لكل العناوين' : allow.length ? `مقصور على ${allow.length} عنواناً` : 'لا عنوان مسموحاً', scopeTone) : ''}
    ${smtpOn ? pill(fromAddr ? `تُرسَل من ${esc(fromAddr)}` : 'بلا عنوان مُرسِل', fromTone) : ''}
    <span style="font-size:var(--fs-meta);color:var(--muted)">${smtpOn
      ? esc(scopeText)
      : 'كل رسالة تُحفظ هنا للمعاينة بدل إرسالها، وتُسجَّل «عُوينت ولم تُرسل» لا «أُرسلت». تفعيل الإرسال الحقيقي يحتاج بيانات خادم البريد من مزوّد النطاق (يُطلب من المالك).'}</span>
    ${smtpOn && fromNote ? `<div style="flex:1 0 100%;font-size:var(--fs-meta);color:var(--${sandbox ? 'amber' : 'red'});line-height:1.8">${esc(fromNote)}</div>` : ''}
    ${/* ── وإلى أي عناوين بالضبط؟ ──
          كان يُقال العدد وحده («مقصور على ٢ عنواناً») لا العناوين. وحرفٌ واحد ناقص في أحدها
          يجعل كل رسالة تُحجب بينما الشاشة كلها خضراء: القناة «مفعّلة»، والعدد «٢»، ولا شيء
          يصل. تُكتب العناوين كما هي ليُقرأ الخطأ بالعين قبل أن يُبحث عنه أياماً. */''}
    ${smtpOn && !openToAll && allow.length ? `<div style="flex:1 0 100%;display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;font-size:var(--fs-meta);color:var(--muted)">
      <span>العناوين المسموح بها:</span>
      ${allow.map((a) => `<code dir="ltr" style="background:var(--surface2,#f1f5f9);border:1px solid var(--line);border-radius:6px;padding:.1rem .4rem;font-size:11.5px">${esc(a)}</code>`).join('')}
      <span>· وما عداها يُحجب ويُسجَّل «حُجبت» في السجل أسفل الصفحة.</span>
    </div>` : ''}
    ${/* ── القناة الاحتياطية ──
          البريد بابُ المنصة الوحيد (الدخول برمزٍ بريدي)، فقناةٌ ثانيةٌ بمزوّدٍ ونطاقٍ آخرين
          هي الفارق بين انقطاعٍ ساعة وانقطاعٍ يوم. وحالتها تُقال هنا لأن غيابها لا يظهر في
          أي مكانٍ آخر: كل شيء يبدو سليماً حتى تسقط الأولى. */''}
    ${smtpOn ? `<div style="flex:1 0 100%;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;padding-top:.5rem;border-top:1px dashed var(--line)">
      <span style="font-weight:700;font-size:var(--fs-meta)">القناة الاحتياطية</span>
      ${fbReady ? pill(`جاهزة · تُرسَل من ${esc(fbAddr)}`, 'green') : pill('غير مضبوطة', 'amber')}
      <span style="font-size:var(--fs-meta);color:var(--muted)">${fbReady
        ? 'تُجرَّب تلقائياً حين تُخفق الأصلية، ويُكتب ذلك في سجل الرسالة.'
        : 'لا بديل اليوم: إن سكتت القناة الأصلية توقّف الدخول إلى المنصة كلها.'}</span>
    </div>` : ''}
    ${/* رسالة تجربة إلى عنوان القارئ نفسه — لا حقل مستقبِل، فلا تصلح لإرسال شيءٍ لأحد.
          وبها يُختبر البديل بلا تعطيل الأصلية على بيئةٍ يعمل عليها الناس. */''}
    ${smtpOn && canTest ? `<div style="flex:1 0 100%;display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;padding-top:.5rem;border-top:1px dashed var(--line)">
      <span style="font-weight:700;font-size:var(--fs-meta)">تحقّق</span>
      <button class="btn btn-sm" data-action="mail-test" data-channel="primary">جرّب الأصلية</button>
      <button class="btn btn-sm" data-action="mail-test" data-channel="fallback"${fbReady ? '' : ' disabled title="اضبط القناة الاحتياطية أولاً"'}>جرّب الاحتياطية</button>
      <span style="font-size:var(--fs-meta);color:var(--muted)">تصل إلى عنوان حسابك أنت، والنتيجة تُقيَّد في السجل أسفل الصفحة.</span>
    </div>` : ''}
  </div>`);

  const fileRows = files.map(({ f, t }) => {
    const name = f.replace(/^\d+_/, '').replace(/_/g, ' ').replace(/\.html$/, '');
    return `<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-body)">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span style="flex:none;font-size:var(--fs-micro);color:var(--faint)" class="tnum">${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}</span>
      <button class="btn btn-sm" data-action="preview-mail" data-file="${esc(f)}">معاينة</button>
    </div>`;
  }).join('') || `<div class="empty-state"><div class="t">لا رسائل بعد</div><div class="s">أرسل تقريراً تجريبياً من صفحة التقارير وستظهر رسالته هنا فوراً.</div></div>`;

  const qRows = queue.map((q) => {
    let to = ''; try { to = (JSON.parse(q.to_json || '[]') || []).join('، '); } catch { to = ''; }
    return `<tr style="border-bottom:1px solid var(--line)">
      <td style="padding:.4rem .6rem;font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.subject || '')}</td>
      <td style="padding:.4rem .6rem;font-size:11px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(to)}</td>
      <td style="padding:.4rem .6rem;text-align:center">${pill(esc(mailStatusLabel(q.status)), mailStatusTone(q.status))}</td>
      <td style="padding:.4rem .6rem;text-align:center;font-size:11px;color:var(--muted)" class="tnum">${String(q.created_at || '').slice(0, 16).replace('T', ' ')}</td>
    </tr>${q.last_error ? `<tr><td colspan="4" style="padding:0 .6rem .4rem;font-size:var(--fs-micro);color:var(--red)">${esc(q.last_error)}</td></tr>` : ''}`;
  }).join('') || `<tr><td colspan="4"><div class="empty-state" style="padding:1rem"><div class="s">الطابور فارغ</div></div></td></tr>`;

  const logRows = logs.map((l) => `<div style="display:flex;gap:.6rem;padding:.32rem 0;border-bottom:1px dashed var(--line);font-size:var(--fs-meta)">
      <span style="flex:none;color:var(--muted)" class="tnum">${String(l.at || '').slice(5, 16).replace('T', ' ')}</span>
      <span style="flex:none">${pill(esc(mailEventLabel(l.event)), mailStatusTone(l.event))}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2)">${esc(l.subject || l.detail || '')}</span>
    </div>`).join('') || `<div style="font-size:var(--fs-meta);color:var(--faint);padding:.4rem 0">لا أحداث بعد</div>`;

  // ── سياسة بريد الاعتمادات — لمدير النظام وحده (الصفحة تُفتح أيضاً لمكتب الرئيس اطّلاعاً،
  // والقرار قرارُ مدير النظام؛ والخادم يحرس الكتابة بنفس الشرط لا بالشاشة وحدها). ──
  let policyCard = '';
  if (user?.role_id === 'admin') {
    const r = await loadApprovalMailRules();
    policyCard = card(`<div style="padding:.85rem 1rem;display:flex;flex-direction:column;gap:.6rem">
      <div style="font-weight:800;font-size:13.5px">سياسة بريد الاعتمادات</div>
      <label style="display:flex;align-items:center;gap:.5rem;font-size:var(--fs-body);flex-wrap:wrap">
        <input type="checkbox" id="pol-reminder"${r.reminderEnabled ? ' checked' : ''}>
        التذكير الدوري بالطلبات المعلَّقة
        <span style="font-size:var(--fs-meta);color:var(--muted)">يُرسَل داخل ساعات العمل (8–18 بتوقيت الرياض) فقط.</span>
      </label>
      <div style="display:flex;gap:.9rem;flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="margin:0"><label for="pol-hours">فاصل التذكير بالساعات</label>
          <input class="input tnum" id="pol-hours" type="number" min="1" max="168" value="${r.reminderIntervalMs / 3600000}"${r.reminderEnabled ? '' : ' disabled'} style="width:110px">
          <div style="font-size:var(--fs-meta);color:var(--muted)">من 1 إلى 168 ساعة.</div></div>
        <div class="field" style="margin:0"><label for="pol-cooldown">تهدئة رسائل الطلبات الجديدة بالدقائق</label>
          <input class="input tnum" id="pol-cooldown" type="number" min="0" max="1440" value="${r.newCooldownMs / 60000}" style="width:110px">
          <div style="font-size:var(--fs-meta);color:var(--muted)">0 = رسالة فور وصول كل طلب جديد، في أي ساعة.</div></div>
        <button class="btn btn-primary btn-sm" data-action="save-mail-policy">حفظ</button>
      </div>
    </div>`);
  }

  const th = (t, a) => `<th style="padding:.4rem .6rem;font-size:var(--fs-micro);color:var(--muted);font-weight:700;text-align:${a || 'right'}">${t}</th>`;
  const body = `
    ${chan}
    ${policyCard ? `<div style="margin-top:.9rem">${policyCard}</div>` : ''}
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:.9rem;margin-top:.9rem">
      ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800;font-size:13.5px">صندوق المعاينة</div>
          <a class="btn btn-sm" href="/app/reports">إرسال تقرير الآن</a></div>
        <div style="padding:.5rem 1rem .8rem">${fileRows}</div>`)}
      <div style="display:flex;flex-direction:column;gap:.9rem">
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">طابور الإرسال</div>
          <div class="tblwrap"><table style="width:100%;border-collapse:collapse"><thead><tr>${th('الموضوع')}${th('إلى')}${th('الحالة', 'center')}${th('متى', 'center')}</tr></thead><tbody>${qRows}</tbody></table></div>`)}
        ${card(`<div style="padding:.85rem 1rem;border-bottom:1px solid var(--line);font-weight:800;font-size:13.5px">سجل الأحداث</div>
          <div style="padding:.4rem 1rem .7rem">${logRows}</div>`)}
      </div>
    </div>
    <div id="mail-preview" class="modal" data-action="close-mail-modal"><div class="modal-card" style="width:760px;max-width:96vw">
      <div class="modal-head"><div style="font-weight:800;font-size:13.5px">معاينة الرسالة</div><button class="btn btn-ghost btn-sm" data-action="close-mail">✕</button></div>
      <iframe id="mail-frame" sandbox="" referrerpolicy="no-referrer" style="width:100%;height:70vh;border:none;background:#fff"></iframe>
    </div></div>`;
  return layout({ user, active: 'mail', title: 'مركز البريد', subtitle: 'صادرات المنصة: معاينة، طابور، وسجل', body, year: opts.year, scripts: ['/static/pages/mail.js'] });
}

// نص الرسالة الخام للمعاينة (يُخدم عبر مسار ويب مقيّد بنفس صلاحية الصفحة)
export function outboxFileHtml(fileName) {
  if (!/^[\w؀-ۿ.-]+\.html$/.test(fileName)) return null;
  try { return readFileSync(resolve(ROOT, 'data/outbox', fileName), 'utf8'); } catch { return null; }
}
