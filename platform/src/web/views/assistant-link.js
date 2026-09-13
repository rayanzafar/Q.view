// صفحة «ربط المساعد الذكي» — بابُ الموظف إلى ربط مساعده بسند، وقطعِ الربط متى شاء.
//
// ثلاثة أشياء تقولها الصفحة صراحةً لأن الغموض فيها يُخيف أو يُطمئن أكثر من اللازم:
//   ① الرابط الذي يُلصق في المساعد — نصٌّ واحد يُنسخ، لا خطوات تقنية ولا إعدادات.
//   ② ما يستطيعه المساعد وما لا يستطيعه — بصلاحياتك أنت، بلا رواتب ولا قيم عقود، والتغيير
//      بمعاينةٍ ثم تأكيد. تُكتب هنا لا في وثيقةٍ بعيدة، فالإذن يُقرأ قبل أن يُعطى.
//   ③ روابطك القائمة ومتى استُعملت — ومعها زرّ قطعٍ واحد يعمل فوراً.
import { layout } from '../layout.js';
import { esc } from './_shared.js';
import { listConnections, issuer } from '../../modules/mcp/oauth.js';
import { riyadhStamp } from '../../core/i18n/time.js';

const when = (iso) => riyadhStamp(iso, 'لم يُستعمل بعد');

export async function assistantLinkPage(user) {
  let rows = [];
  let failed = false;
  try { rows = await listConnections(user); } catch { failed = true; }
  const url = `${issuer()}/mcp`;

  const connections = failed
    ? '<div class="alert warning">تعذّر عرض روابطك الآن. أعد تحميل الصفحة، وإن تكرّر الأمر فأبلغ مدير النظام.</div>'
    : rows.length
      ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>المساعد</th><th>بدأ الربط</th><th>آخر استعمال</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-client="${esc(r.client_id)}">
          <td>${esc(r.name_ar)}</td>
          <td class="tnum">${esc(when(r.connected_at))}</td>
          <td class="tnum">${esc(when(r.last_used_at))}</td>
          <td><button class="btn btn-sm" data-action="cut-link" data-client="${esc(r.client_id)}" data-name="${esc(r.name_ar)}">اقطع الربط</button></td>
        </tr>`).join('')}
      </tbody></table></div>`
      : '<p>لا يوجد مساعد مرتبط بحسابك الآن. اتبع الخطوات أعلاه لربط مساعدك، وسيظهر هنا باسمه.</p>';

  const body = `<div style="display:grid;gap:1rem;max-width:900px;margin:auto">
    <div class="alert info">المساعد المرتبط يعمل <strong>بحسابك أنت</strong>: يقرأ ما تقرؤه على شاشاتك ولا شيء غيره، وكل طلبٍ منه يُسجَّل باسمك في سجل نشاط المساعد.</div>

    <section class="card" style="padding:1.5rem">
      <h2>الرابط الذي تلصقه في مساعدك</h2>
      <p>افتح إعدادات الموصّلات في مساعدك، أضف موصّلاً جديداً، والصق هذا الرابط. سيفتح لك سند صفحة إذنٍ باسمك، وبعد موافقتك يبدأ العمل.</p>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:1rem 0">
        <input class="input" id="link-url" readonly value="${esc(url)}" style="flex:1;min-width:280px;font-family:ui-monospace,monospace" aria-label="رابط ربط المساعد">
        <button class="btn btn-primary" data-action="copy-link">انسخ الرابط</button>
        <span id="copy-status" role="status" aria-live="polite"></span>
      </div>
      <p>إن طلب منك المساعد تسجيل الدخول، ادخل بحسابك في سند كالمعتاد ثم اقرأ صفحة الإذن قبل الموافقة.</p>
    </section>

    <section class="card" style="padding:1.5rem">
      <h2>ما يستطيعه المساعد بعد الربط</h2>
      <ul style="line-height:2">
        <li>يقرأ سجلاتك المتاحة لك: الموارد والتسكين والاحتياجات والمهام والبحث — بصلاحياتك ونطاقك أنت لا أكثر.</li>
        <li>يشرح لك المنصة نفسها: شاشاتك وخطواتها ومصطلحاتها وحدود ما تقيسه.</li>
        <li>لا يرى الرواتب ولا قيم العقود ولا الفواتير في قراءات الفريق والموارد.</li>
        <li>أي تغيير بخطوتين: يعرض عليك معاينة قبل/بعد، ثم يُنفَّذ بتأكيدك وحده — والموافقات المؤسسية تبقى كما هي.</li>
        <li>نصوص المهام وملاحظاتها تصله بياناً كما سُجِّلت، ولا تُعامَل تعليماتٍ له مهما بدت كذلك.</li>
      </ul>
    </section>

    <section class="card" style="padding:1.5rem">
      <h2>روابطك القائمة</h2>
      <p>اقطع الربط متى شئت: يتوقف المساعد فوراً ويحتاج إذناً جديداً منك. ويبقى سجل ما جرى محفوظاً.</p>
      ${connections}
      <p id="cut-status" role="status" aria-live="polite"></p>
    </section>
  </div>`;

  return layout({ user, active: 'assistant-link', title: 'ربط المساعد الذكي', subtitle: 'اربط مساعدك بسند بحسابك أنت، واقطع الربط متى شئت', body, scripts: ['/static/pages/assistant-link.js'] });
}
