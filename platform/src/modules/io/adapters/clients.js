// محوّل استيراد/تصدير العملاء. خدمة العملاء المستقلة قد لا تكون موجودة بعد (تُبنى في حارة أخرى)،
// لذلك يحمل هذا المحوّل خدمة مصغّرة داخلية (إنشاء/تحديث عميل + جهة اتصال) بنفس قواعد المنصة:
// فحص الصلاحية + تدقيق لكل كتابة + حذف ناعم. لا اعتماد على أي وحدة خارج النواة.
import { all, get, insert, update } from '../../../core/db/index.js';
import { can } from '../../../core/rbac/index.js';
import { audit } from '../../../core/audit/index.js';
import { id, nowIso } from '../../../core/util/ids.js';
import { forbidden } from '../../../core/http/errors.js';
import { normalizeText } from '../parse.js';

const TYPES = [
  { v: 'حكومي', labels: ['حكومي', 'حكومة', 'gov'] },
  { v: 'شبه حكومي', labels: ['شبه حكومي', 'شبة حكومي'] },
  { v: 'خاص', labels: ['خاص', 'قطاع خاص'] },
  { v: 'داخلي', labels: ['داخلي'] },
];
const ACTIVE = [
  { v: 'نشط', labels: ['نشط', '1'] },
  { v: 'غير نشط', labels: ['غير نشط', 'موقوف', '0'] },
];

// ── خدمة العميل المصغّرة (داخلية للمحوّل) ──
async function svcCreateClient(ctx, data) {
  if (!can(ctx.user, 'create', 'client')) throw forbidden('إضافة عميل تتطلب صلاحية إنشاء العملاء');
  const cid = id('cli');
  await insert('client', {
    id: cid, code: data.code || null, name_ar: data.name_ar, name_en: data.name_en || null,
    type: data.type || null, sector_market: data.sector_market || null,
    active: data.active == null ? 1 : data.active, created_at: nowIso(), created_by: ctx.user.id,
  });
  await audit(ctx, { action: 'create', resource: 'client', resourceId: cid, detail: { source: 'import' } });
  return await get('SELECT * FROM client WHERE id = ?', [cid]);
}
async function svcUpdateClient(ctx, existing, patch) {
  if (!can(ctx.user, 'update', 'client', existing)) throw forbidden('تعديل العميل يتطلب صلاحية تعديل العملاء');
  await update('client', existing.id, { ...patch, updated_at: nowIso() });
  await audit(ctx, { action: 'update', resource: 'client', resourceId: existing.id, detail: Object.keys(patch) });
  return await get('SELECT * FROM client WHERE id = ?', [existing.id]);
}
async function svcUpsertContact(ctx, clientId, data, existing) {
  if (!existing) {
    const coid = id('cnt');
    await insert('contact', {
      id: coid, client_id: clientId, name: data.contact_name, title: data.contact_title || null,
      email: data.contact_email || null, phone: data.contact_phone || null, created_at: nowIso(),
    });
    await audit(ctx, { action: 'create', resource: 'contact', resourceId: coid, detail: { client: clientId } });
    return await get('SELECT * FROM contact WHERE id = ?', [coid]);
  }
  await update('contact', existing.id, {
    title: data.contact_title ?? existing.title, email: data.contact_email ?? existing.email,
    phone: data.contact_phone ?? existing.phone,
  });
  await audit(ctx, { action: 'update', resource: 'contact', resourceId: existing.id, detail: { client: clientId } });
  return await get('SELECT * FROM contact WHERE id = ?', [existing.id]);
}

async function firstContact(clientId) {
  return await get('SELECT * FROM contact WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [clientId]);
}
async function contactByName(clientId, name) {
  const rows = await all('SELECT * FROM contact WHERE client_id = ? AND deleted_at IS NULL', [clientId]);
  const q = normalizeText(name);
  return rows.find((c) => normalizeText(c.name) === q) || null;
}

const CONTACT_KEYS = ['contact_name', 'contact_title', 'contact_email', 'contact_phone'];

export default {
  type: 'clients',
  labelAr: 'العملاء',
  resource: 'client',
  keySets: [['code'], ['name_ar']],
  columns: [
    { key: 'code', labelAr: 'الكود', aliases: ['رمز العميل', 'code'] },
    { key: 'name_ar', labelAr: 'اسم العميل', required: true, aliases: ['الاسم', 'العميل'] },
    { key: 'name_en', labelAr: 'الاسم الإنجليزي', aliases: ['name en', 'الاسم اللاتيني'] },
    { key: 'type', labelAr: 'التصنيف', parse: 'enum', enum: TYPES, aliases: ['النوع', 'نوع العميل'] },
    { key: 'sector_market', labelAr: 'القطاع السوقي', aliases: ['السوق'] },
    { key: 'active', labelAr: 'الحالة', parse: 'enum', enum: ACTIVE },
    { key: 'contact_name', labelAr: 'جهة الاتصال', aliases: ['اسم جهة الاتصال', 'المسؤول لدى العميل'] },
    { key: 'contact_title', labelAr: 'منصب جهة الاتصال', aliases: ['المنصب'] },
    { key: 'contact_email', labelAr: 'البريد الإلكتروني', aliases: ['الايميل', 'البريد'] },
    { key: 'contact_phone', labelAr: 'الجوال', aliases: ['الهاتف', 'رقم الجوال'] },
  ],
  exampleRow: {
    code: 'CL-001', name_ar: 'وزارة النقل', name_en: 'Ministry of Transport', type: 'حكومي',
    sector_market: 'النقل واللوجستيات', active: 'نشط', contact_name: 'م. سعد العتيبي',
    contact_title: 'مدير المشاريع', contact_email: 'saad@example.gov.sa', contact_phone: '0555555555',
  },

  async fetchRows(user, filters = {}) {
    const clients = await all('SELECT * FROM client WHERE deleted_at IS NULL ORDER BY name_ar');
    const contacts = await all('SELECT * FROM contact WHERE deleted_at IS NULL ORDER BY created_at');
    const firstByClient = {};
    for (const c of contacts) if (!firstByClient[c.client_id]) firstByClient[c.client_id] = c;
    let rows = clients;
    if (filters.type) rows = rows.filter((c) => c.type === filters.type);
    return rows.map((c) => {
      const ct = firstByClient[c.id];
      return {
        code: c.code, name_ar: c.name_ar, name_en: c.name_en, type: c.type,
        sector_market: c.sector_market, active: c.active ? 'نشط' : 'غير نشط',
        contact_name: ct?.name, contact_title: ct?.title, contact_email: ct?.email, contact_phone: ct?.phone,
      };
    });
  },

  async resolveRow(ctx, mapped, opts = {}) {
    let existing = null;
    if (mapped.code && opts.keyField !== 'name_ar') {
      existing = await get('SELECT * FROM client WHERE code = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [mapped.code]);
    }
    if (!existing && mapped.name_ar) {
      const rows = await all('SELECT * FROM client WHERE deleted_at IS NULL');
      const q = normalizeText(mapped.name_ar);
      existing = rows.find((c) => normalizeText(c.name_ar) === q) || null;
    }
    if (!existing) return { action: 'create', existing: null, changes: [] };
    const changes = [];
    for (const [k, field] of [['code', 'code'], ['name_ar', 'name_ar'], ['name_en', 'name_en'], ['type', 'type'], ['sector_market', 'sector_market']]) {
      if (mapped[k] != null && String(existing[field] ?? '') !== String(mapped[k])) changes.push(k);
    }
    if (mapped.active != null && (existing.active ? 'نشط' : 'غير نشط') !== mapped.active) changes.push('active');
    let contact = null;
    if (mapped.contact_name) {
      contact = await contactByName(existing.id, mapped.contact_name);
      if (!contact) changes.push('contact_name');
      else {
        for (const [k, field] of [['contact_title', 'title'], ['contact_email', 'email'], ['contact_phone', 'phone']]) {
          if (mapped[k] != null && String(contact[field] ?? '') !== String(mapped[k])) changes.push(k);
        }
      }
    }
    return { action: changes.length ? 'update' : 'skip', existing, changes, contact };
  },

  rowTarget() { return {}; }, // العميل سجل على مستوى الشركة (لا قطاع على الصف)
  rowLabel(mapped) { return mapped.name_ar || mapped.code || ''; },

  async applyRow(ctx, mapped, resolved) {
    if (resolved.action === 'create') {
      const client = await svcCreateClient(ctx, {
        code: mapped.code, name_ar: mapped.name_ar, name_en: mapped.name_en,
        type: mapped.type, sector_market: mapped.sector_market,
        active: mapped.active == null ? 1 : (mapped.active === 'نشط' ? 1 : 0),
      });
      let contact = null;
      if (mapped.contact_name) contact = await svcUpsertContact(ctx, client.id, mapped, null);
      return { resource: 'client', resourceId: client.id, before: null, after: { client, contact } };
    }
    const beforeClient = resolved.existing;
    const beforeContact = mapped.contact_name ? await contactByName(beforeClient.id, mapped.contact_name) : await firstContact(beforeClient.id);
    const patch = {};
    for (const k of resolved.changes) {
      if (k === 'active') patch.active = mapped.active === 'نشط' ? 1 : 0;
      else if (!CONTACT_KEYS.includes(k)) patch[k] = mapped[k];
    }
    const client = Object.keys(patch).length ? await svcUpdateClient(ctx, beforeClient, patch) : beforeClient;
    let contact = beforeContact;
    if (resolved.changes.some((k) => CONTACT_KEYS.includes(k))) {
      contact = await svcUpsertContact(ctx, beforeClient.id, mapped, beforeContact);
    }
    return {
      resource: 'client', resourceId: beforeClient.id,
      before: { client: beforeClient, contact: beforeContact }, after: { client, contact },
    };
  },

  async undoRow(ctx, row) {
    if (row.action === 'create') {
      const createdContact = row.after?.contact;
      if (createdContact) {
        await update('contact', createdContact.id, { deleted_at: nowIso() });
        await audit(ctx, { action: 'delete', resource: 'contact', resourceId: createdContact.id, detail: { undoImport: true } });
      }
      await update('client', row.resource_id, { deleted_at: nowIso() });
      await audit(ctx, { action: 'delete', resource: 'client', resourceId: row.resource_id, detail: { undoImport: true } });
      return;
    }
    const b = row.before;
    if (!b?.client) return;
    const cur = await get('SELECT * FROM client WHERE id = ?', [row.resource_id]);
    if (cur) {
      await svcUpdateClient(ctx, cur, {
        code: b.client.code, name_ar: b.client.name_ar, name_en: b.client.name_en,
        type: b.client.type, sector_market: b.client.sector_market, active: b.client.active,
      });
    }
    const afterContact = row.after?.contact;
    if (afterContact && !b.contact) {
      // جهة اتصال أُنشئت أثناء التحديث → تُحذف حذفاً ناعماً عند التراجع
      await update('contact', afterContact.id, { deleted_at: nowIso() });
      await audit(ctx, { action: 'delete', resource: 'contact', resourceId: afterContact.id, detail: { undoImport: true } });
    } else if (afterContact && b.contact) {
      await update('contact', b.contact.id, { title: b.contact.title, email: b.contact.email, phone: b.contact.phone });
      await audit(ctx, { action: 'update', resource: 'contact', resourceId: b.contact.id, detail: { undoImport: true } });
    }
  },
};
