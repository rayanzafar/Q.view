// رسائل «مركز التطوير» — سبعُ رسائل تُغطّي رحلة البلاغ كاملة، بلسانٍ يفهمه من أبلغ لا
// بلسان من يبرمج. منفصلةٌ عن رسائل الاعتمادات والتقارير كما انفصلت تلك عن بعضها وللسبب
// نفسه: ذيلُ رسالةٍ لا يخصّ قارئها ضجيجٌ يُفقد الرسالة ثقتها.
//
// وثلاث قواعد تحكم كل رسالة هنا:
//   ① **كلُّ نصٍّ متغيّرٍ يمرّ من `esc`** — عنوانُ البلاغ ونصُّه يكتبهما مجهولٌ من رابطٍ عام،
//      فهما أخطرُ مدخلٍ في المنتج كله. لا استثناء ولا «هذا الحقل من عندنا».
//   ② **اللون من هوية المنتج** إن كان له لونٌ مسجَّل، وإلا فلون سند — والإطار إطار EVC دائماً.
//   ③ **الإرسال طابورٌ لا اتصال**: الصفّ يُكتب في `email_queue` ومعه سطرٌ في `email_log`،
//      والجدولُ الدوري القائم يرسله كما يرسل بريد الاعتمادات — لا مُرسِلَ ثانٍ في المنتج.

import { insert } from '../db/index.js';
import { id, nowIso } from '../util/ids.js';
import { config } from '../config.js';
import {
  itemStatusLabel, itemTypeLabel, itemUrgencyLabel,
} from '../../modules/products/labels.js';

const BRAND = '#244A99', BRAND2 = '#834798', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// لونُ المنتج يُقبل ست عشرياً فقط — القيمة تُحقن في نمطٍ داخل الرسالة، وأيُّ نصٍّ حرٍّ هنا
// بابُ حقنٍ في بريدٍ يُفتح خارج المنصة. (الخدمة تحرسه عند الحفظ، وهذا حارسُ العرض.)
const brandOf = (product) => (/^#[0-9a-fA-F]{6}$/.test(String(product?.brand_color || '')) ? product.brand_color : BRAND);

const url = () => String(config.platformUrl || '').replace(/\/$/, '');

function shell({ product, title, lead, rows = [], note, cta, ctaHref }) {
  const color = brandOf(product);
  const rowsHtml = rows.filter(Boolean).map((r) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:12px;color:${MUTED};width:110px">${esc(r[0])}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK}">${esc(r[1])}</td>
  </tr>`).join('');
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0">
<tr><td align="center">
<table role="presentation" dir="rtl" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#fff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
  <tr><td style="background:${color} linear-gradient(120deg,${color},${BRAND2});padding:20px 24px;color:#fff">
    <div style="font-size:13px;opacity:.9">EVC · رؤية الخبراء الاستشارية · ${esc(product?.name_ar || 'منصة سند')}</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div>
  </td></tr>
  <tr><td style="padding:22px 24px">
    <div style="font-size:14px;line-height:1.9;color:${INK}">${esc(lead)}</div>
    ${rowsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 4px">${rowsHtml}</table>` : ''}
    ${note ? `<div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-right:3px solid ${color};font-size:13px;line-height:1.9;color:${INK};white-space:pre-wrap">${esc(note)}</div>` : ''}
    ${cta ? `<div style="text-align:center;margin:20px 0 4px">
      <a href="${esc(ctaHref || url())}" style="display:inline-block;background:${color};color:#fff;font-size:14px;font-weight:700;
        padding:11px 26px;border-radius:10px;text-decoration:none">${esc(cta)}</a>
    </div>` : ''}
  </td></tr>
  <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};line-height:1.8">
    وصلتك هذه الرسالة لأن بلاغاً أو اقتراحاً يخصّك في ${esc(product?.name_ar || 'منصة سند')}.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

const itemRows = (item) => [
  ['الرقم', item?.item_key || ''],
  ['النوع', itemTypeLabel(item?.type)],
  item?.urgency ? ['الأثر', itemUrgencyLabel(item.urgency)] : null,
  item?.where_text ? ['أين حدث', item.where_text] : null,
  ['الحال', itemStatusLabel(item?.status)],
];

const trackHref = (item) => (item?.tracking_token ? `${url()}/p/t/${item.tracking_token}` : null);
const itemHref = (item) => `${url()}/app/dev-center/${item?.product_id || ''}`;

/** ① إشعارُ الاستلام لمن أبلغ — يحمل رقمه ورابط متابعته إن كان بلاغاً خارجياً. */
export function itemReceiptMail({ product, item }) {
  const href = trackHref(item);
  return {
    subject: `وصلنا بلاغك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'وصلنا بلاغك',
      lead: `شكراً لك. سجّلنا ما أرسلته برقم ${item?.item_key || ''}، وسيصلك خبرٌ عند كل خطوة.`,
      rows: [['العنوان', item?.title || ''], ...itemRows(item)],
      cta: href ? 'تابع حالة بلاغك' : null, ctaHref: href,
    }),
  };
}

/** ② بلاغٌ جديد وصل الفريق. */
export function newItemTeamMail({ product, item }) {
  return {
    subject: `${itemTypeLabel(item?.type)} جديد — ${item?.item_key || ''}`,
    html: shell({
      product, title: `${itemTypeLabel(item?.type)} جديد`,
      lead: item?.title || '',
      rows: [...itemRows(item), item?.reporter_name ? ['من أبلغ', item.reporter_name] : null],
      note: item?.description || null,
      cta: 'افتح مركز التطوير', ctaHref: itemHref(item),
    }),
  };
}

/** ③ بندٌ يقف عند مدير المنتج. */
export function awaitingApprovalMail({ product, item }) {
  return {
    subject: `بانتظار اعتمادك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'بانتظار اعتمادك',
      lead: `${item?.title || ''} — درسه الفريق وينتظر قرارك.`,
      rows: [...itemRows(item), item?.est_hours ? ['ساعات مقدَّرة', String(item.est_hours)] : null],
      note: item?.dev_description || null,
      cta: 'افتح واعتمد', ctaHref: itemHref(item),
    }),
  };
}

/** ④ اعتُمد وأُسنِد — تصل من أُسنِد إليه. */
export function itemApprovedMail({ product, item }) {
  return {
    subject: `اعتُمد وأُسنِد إليك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'اعتُمد وأُسنِد إليك',
      lead: `${item?.title || ''} — أُنشئت لك مهمةٌ به في مهامك.`,
      rows: [...itemRows(item), item?.est_hours ? ['ساعات مقدَّرة', String(item.est_hours)] : null],
      cta: 'افتح مهامك', ctaHref: `${url()}/app/tasks`,
    }),
  };
}

/** ⑤ سؤالٌ إلى من أبلغ — ولا تتقدّم الدراسة حتى يصل جوابه. */
export function needsInfoMail({ product, item, question }) {
  const href = trackHref(item);
  return {
    subject: `سؤالٌ عن بلاغك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'نحتاج توضيحاً منك',
      lead: `${item?.title || ''} — عندنا سؤالٌ واحد قبل أن نُكمل:`,
      note: question || '',
      rows: itemRows(item),
      cta: href ? 'أجب من هنا' : null, ctaHref: href,
    }),
  };
}

/** ⑥ وصل الحل. */
export function itemResolvedMail({ product, item, version }) {
  const href = trackHref(item);
  return {
    subject: `تم حلّ بلاغك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'تم حلّ بلاغك',
      lead: `${item?.title || ''} — وصل الحل${version?.label ? ` في إصدار ${version.label}` : ''}.`,
      rows: [...itemRows(item), version?.released_on ? ['تاريخ الإصدار', version.released_on] : null],
      cta: href ? 'افتح صفحة المتابعة' : null, ctaHref: href,
    }),
  };
}

/** ⑦ الاعتذارُ بسببه: نصُّ السبب يصل كما كُتب — ولذلك يُحذَّر كاتبه قبل أن يرسله. */
export function itemDeclinedMail({ product, item, reason }) {
  const href = trackHref(item);
  return {
    subject: `قرارٌ في بلاغك — ${item?.item_key || ''}`,
    html: shell({
      product, title: 'لن نُكمل في هذا البلاغ',
      lead: `${item?.title || ''} — درسناه ولن نُكمل فيه، وهذا السبب:`,
      note: reason || '',
      rows: itemRows(item),
      cta: href ? 'افتح صفحة المتابعة' : null, ctaHref: href,
    }),
  };
}

/**
 * وضعُ الرسالة في الطابور — نفسُ خطوتَي بريد الاعتمادات حرفياً: صفٌّ في الطابور وسطرٌ في
 * سجلّه. والجدولُ الدوري القائم يلتقطه، فلا تغيير فيه ولا مُرسِلَ ثانٍ.
 */
export async function enqueueProductMail(to, mail, tag = 'product_item') {
  const address = String(to || '').trim();
  if (!address || !mail?.subject) return null;
  const qid = id('eq');
  const at = nowIso();
  await insert('email_queue', {
    id: qid, schedule_id: null, to_json: JSON.stringify([address]), cc_json: JSON.stringify([]),
    subject: mail.subject, html: mail.html, status: 'QUEUED', created_at: at,
  });
  await insert('email_log', { id: id('el'), queue_id: qid, event: 'enqueued', detail: tag, at });
  return qid;
}
