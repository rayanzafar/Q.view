# خطط ما قبل الاعتماد — ملاحظات المالك ٢٠٢٦-٠٨-٢٥

ثماني ملاحظات وصلت من المالك (عبر حسين الجفري) في ٢٥ أغسطس ٢٠٢٦. حُقِّق في كلٍّ منها على الكود
الحي قبل أي تصميم — خمس عمليات مسحٍ للكود ثم ثلاثة تصاميم — وخرجت **ست حزم عمل**، لكل حزمة
ملفُ خطةٍ في هذا المجلد. ثلاث من الحزم تقلب أحكاماً مكتوبة للمالك في الكود واختباراته، ولذلك
رافقت الخططَ وثيقةٌ تنفيذية موجزة (`00-موجز-تنفيذي.md`) تُعرض عليه للحسم، وصفوفٌ في
`docs/OPEN-DECISIONS.md` (D19–D21).

**هذا مجلد خطط، لا مجلد موجة**: لا كود هنا ولا ترحيلات. حين يوافق المالك على حزمة تتخرّج
موجةَ بناءٍ بمجلدها الثلاثي على نمط `opportunities-redesign/` (القاعدة في
`docs/meetings/README.md`)، ويبقى ملفها هنا سجلَّ ما خُطِّط. وما يُرفض يبقى ملفه سجلَّ الرفض.

## الملاحظات الثماني (نصاً كما وردت)

1. «if anyone adds a task the person above them needs approval, not just employee to manager, but also department lead to sector lead and so on, all of these need to go through the approval process, and the approval process needs to be implemented properly»
2. «utilization percentage, so if i set the task utilization of the days, if i say 50% and the task takes a week then 50% of my utilization is used for the rest of the week until the task is finished. if i add 6 tasks that are all due in a month (10 10 10 10 10 50 split) then the entire month my utilization should show as 100%»
3. «مهامي page needs a lot of work: kanban in مهام فريقي is broken and it's not showing anything correctly and it doesn't replace the stuff thats on the page»
4. «utilization of your employees should be shown based on the utilization calculation we are implementing in the مهام فريقي page and other places»
5. «kanban board area says متآخر on completed tasks, we need to save completion date (time when the user set it to منجز) and say completed since instead of showing late that constantly gets bigger in a list of completed task»
6. «تصنيف الفرص اذا كانت proactive or reactive»
7. «تسكين المهام process needs improvement» — وبتوضيح حسين: المقصود تدفّق وضع المهمة تحت جهتها
   وإسنادها لمن هو أدنى — «the process of doing it feels incomplete and lacking info and not ux friendly»
8. «find out how we can add utilization for internal stuff like products and stuff we work on, which includes naming internal tools or developments or products»

## الحزم الست

| الخطة | الملاحظات | ماذا تفعل | تحتاج قرار مالك؟ |
|---|---|---|---|
| [`01-اعتماد-المهام-الشامل.md`](01-اعتماد-المهام-الشامل.md) | ١ | اعتماد واحد لكل مهمة ممّن فوق كاتبها (موظف ← مدير الإدارة ← قائد القطاع ← مكتب الرئيس التنفيذي)، ورفضٌ يُعيد للتصحيح بدل الحذف، وسدّ ثغرة التعديل | **نعم — D19** (يقلب حكمين مكتوبين) |
| [`02-حمل-المهام.md`](02-حمل-المهام.md) | ٢ و٤ | نسبة لكل مهمة يكتبها كاتبها؛ مجموعها = «حِمل المهام» — مقياس ثالث مسمّى يظهر في مهامي ومهام فريقي وملف الشخص | **نعم — D21** (فروع المقياس) |
| [`03-إصلاح-مهامي.md`](03-إصلاح-مهامي.md) | ٣ و٥ | خمس عشرة علّة مؤكدة (KI-075…KI-085 وKI-036): اللوح يحلّ محل الصفحة، و«أُنجزت منذ…» بدل «متأخرة» على المنجز، وبقية العلل | نقطة واحدة صغيرة (إظهار «بانتظار الاعتماد» تحت اللوح) |
| [`04-تصنيف-الفرص.md`](04-تصنيف-الفرص.md) | ٦ | حقل «مصدر المبادرة» على الفرصة: استباقية / استجابة لطلب — على نمط «نوع الطرح» حرفياً، مع إصلاح علّتي الشرائح (KI-086) | نقاط صغيرة (التسمية، نافذة الإنشاء، مقياس الاكتمال) |
| [`05-تسكين-المهام.md`](05-تسكين-المهام.md) | ٧ | منتقي إسنادٍ يعرض حِمل الشخص، ومعاينة «تُعتمد من: فلان»، وإخطار من أُسندت إليه، وسياقٌ أوفى لشاشة الاعتمادات | لا (يرث D19/D21) |
| [`06-المبادرات-الداخلية.md`](06-المبادرات-الداخلية.md) | ٨ | كيان «مبادرة داخلية» مسمّى — ليس مشروعاً — تُسند إليه المهام ويُسكَّن عليه الوقت ويُقرأ حِمله | **نعم — D20** (يقلب «لا كيان اسمه مشاريع داخلية») |

## الترتيب المقترح للبناء

١) إصلاح مهامي (أيام؛ بلا قرارات كبرى) ← ٢) تصنيف الفرص (أيام) ← ٣) الاعتماد الشامل (بعد
موافقة D19؛ يتطلب أولاً تعبئة قائد قطاعٍ لكل قطاع) ← ٤) حِمل المهام + تسكين المهام (بعد D21)
← ٥) المبادرات الداخلية (بعد D20).

أرقام الترحيلات (036…) في الخطط تقديريةٌ وقت الكتابة — تُحسم عند التنفيذ بالتتابع الفعلي.

## أين تُقرأ الأدلة الكاملة

كل ادعاء في الخطط مسنودٌ بشاهد `ملف:سطر` من مسح ٢٠٢٦-٠٨-٢٥ على هذا الفرع. العلل المؤكدة
المكتشفة أثناء المسح قُيّدت فوراً صفوفاً في `docs/KNOWN-ISSUES.md` (KI-075 حتى KI-086)،
والقرارات المفتوحة في `docs/OPEN-DECISIONS.md` (D19–D21).
