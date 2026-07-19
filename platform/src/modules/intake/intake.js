// Project intake — create a project either MANUALLY or auto-filled FROM a contract's text.
// AI extraction is best-effort (provider-agnostic); a deterministic heuristic covers no-key/failure
// so the feature always works. No external call ever receives more than the pasted contract text.
import { all, get, insert, tx } from '../../core/db/index.js';
import { can } from '../../core/rbac/index.js';
import { audit } from '../../core/audit/index.js';
import { id, nowIso, toHalalas } from '../../core/util/ids.js';
import { forbidden, badRequest } from '../../core/http/errors.js';
import { complete, aiMode } from '../../core/ai/provider.js';

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const cleanDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.trim())) ? s.trim().slice(0, 10) : null;

function normalize(p) {
  return {
    title_ar: (p.title_ar || '').toString().trim().slice(0, 200) || null,
    client_name: (p.client_name || '').toString().trim().slice(0, 160) || null,
    value_sar: num(p.value_sar),
    start_date: cleanDate(p.start_date),
    end_date: cleanDate(p.end_date),
    deliverables: Array.isArray(p.deliverables)
      ? p.deliverables.filter((d) => d && d.name_ar).slice(0, 60)
        .map((d) => ({ name_ar: String(d.name_ar).trim().slice(0, 200), amount_sar: num(d.amount_sar) }))
      : [],
  };
}

// Deterministic fallback: largest SAR-looking figure = value; first ISO/dd-mm date; first heading line = title.
function heuristic(text) {
  const amounts = [...text.matchAll(/(\d[\d,\.]{3,})\s*(?:ريال|ر\.?س|SAR)?/g)]
    .map((m) => Number(m[1].replace(/[,\.]/g, ''))).filter((n) => n >= 1000);
  const value = amounts.length ? Math.max(...amounts) : null;
  const iso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  const start_date = iso ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}` : null;
  const firstLine = (text.split('\n').map((l) => l.trim()).find((l) => l.length > 8 && l.length < 160)) || null;
  const clientM = text.match(/(?:العميل|الجهة|الطرف الأول|لصالح|المستفيد)\s*[:：]?\s*([^\n،.]{3,80})/);
  return { title_ar: firstLine, client_name: clientM ? clientM[1].trim() : null, value_sar: value, start_date, end_date: null, deliverables: [] };
}

const SYS = `أنت محلّل عقود خبير في شركة استشارية سعودية. استخرج من نص العقد الحقول التالية وأعِدها JSON فقط دون أي شرح أو أسوار كود:
{"title_ar":"موضوع/اسم المشروع","client_name":"اسم الجهة/العميل","value_sar":<القيمة الإجمالية بالريال رقمًا بلا فواصل أو null>,"start_date":"YYYY-MM-DD أو null","end_date":"YYYY-MM-DD أو null","deliverables":[{"name_ar":"اسم المخرج","amount_sar":<رقم أو null>}]}
القواعد: أرقام لا نصوص؛ استخدم null لأي حقل غائب؛ لا تخترع قيمًا؛ أعِد JSON صحيحًا فقط.`;

export async function parseContract(user, { text }) {
  if (!can(user, 'create', 'project')) throw forbidden('إنشاء المشاريع يتطلب صلاحية إدارة/تشغيل');
  if (!text || text.trim().length < 20) throw badRequest('ألصق نص العقد (٢٠ حرفًا على الأقل)');
  const clipped = text.slice(0, 12000);
  try {
    if (aiMode() === 'local') throw new Error('no_llm');
    const { text: out } = await complete({ system: SYS, user: clipped, maxTokens: 900 });
    const s = out.indexOf('{'), e = out.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('no_json');
    const parsed = JSON.parse(out.slice(s, e + 1));
    return { ...normalize(parsed), _mode: aiMode() };
  } catch (err) {
    return { ...normalize(heuristic(text)), _mode: 'local', _note: 'استُخرج محليًا (بلا نموذج ذكي أو تعذّر التحليل) — يُرجى مراجعة الحقول قبل الإنشاء.' };
  }
}

// Create project + contract + deliverables (+ find-or-create client) in one transaction.
// Used by BOTH the manual form (no deliverables) and the from-contract flow.
// Coerce client-supplied money to a valid, in-range SAR integer so we never write NaN/float/negatives
// into the INTEGER-halalas columns. Out-of-range or non-numeric → 0 (fails safe).
const safeSar = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 1e13 ? n : 0; };

export async function createFromIntake(ctx, data) {
  const user = ctx.user;
  const sectorId = data.sector_id || user.sector_id;
  if (!can(user, 'create', 'project', { sector_id: sectorId })) throw forbidden('خارج نطاق قطاعك');
  const name = (data.name_ar || data.title_ar || '').trim().slice(0, 200);
  if (!name) throw badRequest('اسم المشروع مطلوب');
  const valueSar = safeSar(data.value_sar);
  const now = nowIso();
  const result = await tx(async () => {
    let clientId = data.client_id || null;
    const clientName = (data.client_name || '').trim();
    if (!clientId && clientName) {
      const existing = await get('SELECT id FROM client WHERE name_ar = ? AND deleted_at IS NULL', [clientName]);
      if (existing) clientId = existing.id;
      else { clientId = id('cli'); await insert('client', { id: clientId, name_ar: clientName, active: 1, created_at: now, created_by: user.id }); }
    }
    const pid = id('prj');
    await insert('project', {
      id: pid, name_ar: name, sector_id: sectorId, client_id: clientId, owner_user_id: data.owner_user_id || user.id,
      status: data.status || 'NOT_STARTED', rag: 'GREEN', kind: 'external',
      contract_value_halalas: toHalalas(valueSar), start_date: cleanDate(data.start_date), end_date: cleanDate(data.end_date),
      created_at: now, created_by: user.id,
    });
    const cid = id('con');
    await insert('contract', {
      id: cid, code: (data.contract_code || '').toString().slice(0, 60) || null, client_id: clientId, project_id: pid, sector_id: sectorId,
      value_halalas: toHalalas(valueSar), start_date: cleanDate(data.start_date), end_date: cleanDate(data.end_date),
      status: 'ACTIVE', created_at: now, created_by: user.id,
    });
    let n = 0;
    for (const d of (data.deliverables || [])) {
      const nm = (d && d.name_ar || '').toString().trim().slice(0, 200); if (!nm) continue;
      await insert('deliverable', { id: id('dlv'), project_id: pid, name_ar: nm, amount_halalas: toHalalas(safeSar(d.amount_sar)),
        month: d.month || null, status: 'PENDING', sector_id: sectorId, created_at: now });
      n++;
    }
    return { project_id: pid, contract_id: cid, client_id: clientId, deliverables: n };
  });
  await audit(ctx, { action: 'create', resource: 'project', resourceId: result.project_id, sectorId,
    detail: { via: data.deliverables?.length ? 'contract-intake' : 'manual', deliverables: result.deliverables, contract: result.contract_id } });
  return result;
}
