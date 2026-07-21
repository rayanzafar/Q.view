// اتفاق العدد والمعدود العربي — الطريقة الوحيدة لعرض عدد مع اسمه في الواجهة.
// 1 = مفرد بصيغته، 2 = مثنى، 3–10 = جمع، 11+ = مفرد منصوب (تمييز العدد).
export const countAr = (n, { one, two, few, many, zero }) =>
  n === 0 ? (zero || `لا ${few}`) : n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;

export const dayWord = (n) => countAr(n, { one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يوماً' });
export const monthWord = (n) => countAr(n, { one: 'شهر واحد', two: 'شهرين', few: 'أشهر', many: 'شهراً' });
