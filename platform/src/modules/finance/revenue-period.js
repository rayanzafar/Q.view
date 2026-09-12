import { badRequest } from '../../core/http/errors.js';

const present = (v) => v !== null && v !== undefined && v !== '';
const validYear = (n) => Number.isInteger(n) && n >= 2000 && n <= 2100;
const validMonth = (n) => Number.isInteger(n) && n >= 1 && n <= 12;

// A commercial sale, project name and import timestamp never determine delivery revenue.
// Keep the established acceptance/delivery/status precedence until policy changes explicitly.
export function recognitionPeriod(d) {
  const hasYear = present(d.year); const hasMonth = present(d.month);
  const year = Number(d.year); const month = Number(d.month);
  if ((hasYear && !validYear(year)) || (hasMonth && !validMonth(month))) {
    throw badRequest('فترة المخرج غير صحيحة — حدّد سنة وشهر الاستحقاق');
  }
  if (hasYear && hasMonth) return { year, month, source: 'explicit' };
  const stamp = String(d.accepted_at || d.delivered_at || d.status_at || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(stamp);
  const eventYear = Number(match?.[1]); const eventMonth = Number(match?.[2]);
  const validDate = match && validYear(eventYear) && validMonth(eventMonth)
    && !Number.isNaN(Date.parse(stamp))
    && new Date(stamp).toISOString().slice(0, 10) === stamp.slice(0, 10);
  if (!validDate) throw badRequest('فترة الإيراد غير موثقة — حدّد سنة وشهر استحقاق المخرج قبل الحفظ');
  if ((hasYear && year !== eventYear) || (hasMonth && month !== eventMonth)) {
    throw badRequest('فترة المخرج ناقصة وتختلف عن تاريخ إنجازه — حدّد السنة والشهر معًا');
  }
  return { year: hasYear ? year : eventYear, month: hasMonth ? month : eventMonth, source: 'event' };
}
