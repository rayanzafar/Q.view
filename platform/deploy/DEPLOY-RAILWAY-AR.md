# نشر سند على Railway (أو Render) — بيئة تجريبية على staging.os.evcsol.com

اخترت: **نطاق فرعي** `staging.os.evcsol.com` + استضافة **Railway/Render/Vercel**.
هذا الدليل يوصلك لرابط تجربة شغّال، والمنصة القديمة على `os.evcsol.com` تبقى نسخة احتياطية بلا مساس.

---

## ⚠️ قبل نبدأ — ملاحظتان مهمتان

1. **Vercel لا يصلح لهذا التطبيق.** سند خادم Express دائم التشغيل يكتب في قاعدة
   SQLite على القرص؛ Vercel «بلا خادم» (serverless) وقرصه مؤقّت. **استخدم Railway
   أو Render** (كلاهما يشغّل حاويات دائمة مع قرص ثابت). الدليل أدناه لـRailway، وملاحظات Render في الآخر.

2. **الدفع لـGitHub هو البوابة.** Railway/Render ينشران **من GitHub**، والدفع
   ما زال مرفوضًا `403` (التطبيق قراءة‑فقط). أمامك طريقان:
   - **(أ) تمنح صلاحية الكتابة** (Settings → Installed GitHub Apps → Claude → Contents: Read and write) ثم أدفع أنا، وبعدها تربط Railway بالمستودع.
   - **(ب) تتجاوز GitHub بالكامل** عبر Railway CLI من الحزمة اللي أعطيتك: `railway up` يرفع الكود المحلي مباشرة بدون GitHub. الأسرع لرابط تجربة الآن.

---

## Railway — الخطوات

### 1) أنشئ خدمة جديدة (منفصلة عن الإنتاج = تبقى القديمة باك أب)
- من لوحة Railway: **New → Deploy from GitHub repo** واختر `rayanzafar/Q.view`
  والفرع `claude/evc-platform-analysis-r5nsri`. (أو `railway init` ثم `railway up` من الحزمة محليًا.)
- Railway يقرأ `railway.json` تلقائيًا: يبني عبر `Dockerfile`، ويشغّل
  migrate → seed‑rbac → **seed (حسابات العرض)** → الخادم، وفحص الصحّة على `/ready`.

### 2) قرص ثابت لقاعدة البيانات (مهم — بدونه تُمسح البيانات كل نشر)
- **Variables → New Volume**، ثبّته على المسار `/data`.
- أضِف متغيّر البيئة: `SANAD_DB=/data/sanad.db`

### 3) متغيّرات البيئة
| المتغيّر | القيمة | لازم؟ |
|---|---|---|
| `NODE_ENV` | `production` | ✅ (يجعل الخادم يستمع على 0.0.0.0 تلقائيًا) |
| `SESSION_SECRET` | سلسلة عشوائية طويلة | ✅ |
| `SANAD_DB` | `/data/sanad.db` | ✅ (مع القرص الثابت) |
| `PORT` | يحقنه Railway تلقائيًا | — |
| `OPENAI_API_KEY` | `sk-…` | اختياري (لتعبئة العقود بالذكاء) |
| `MAIL_TRANSPORT` / `SMTP_*` | إعداد بريدك | اختياري |

### 4) بيانات العرض على staging (لا شيء حسّاس في Git)
النشر يعطيك **حسابات الدخول** (`demo.ceo` … كلمة المرور `Sanad@2026`) لكن قاعدة
الأعمال (المشاريع/الفرص/العملاء) تأتي من لقطة بياناتك، **وهي ليست في Git** (تحوي رواتب/عناوين IP).
لتعبئة staging ببياناتك الحقيقية مرة واحدة، وعلى القرص الخاص فقط:
```bash
# ارفع اللقطة للقرص الثابت (خاصة، ليست في المستودع) ثم:
railway run npm run migrate-legacy
```
- بديل سريع: اتركها بحسابات العرض فقط (واجهة شغّالة ببيانات قليلة).
- الرواتب في التطبيق محجوبة أصلًا بالصلاحيات (HR/الأدمن فقط)، والبيانات كلها خلف تسجيل الدخول.

### 5) اربط النطاق الفرعي
- **Settings → Networking → Custom Domain** → أدخل `staging.os.evcsol.com`.
- Railway يعطيك هدف `CNAME`. أضِفه عند مزوّد DNS:
  ```
  staging  CNAME  <target>.up.railway.app
  ```
- الـTLS (https) يُصدر تلقائيًا خلال دقائق.

### 6) تحقّق ✅
`https://staging.os.evcsol.com` → دخول بحساب عرض. `os.evcsol.com` القديمة لم تُمَس.

---

## Render (بديل مكافئ)
- **New → Web Service** من المستودع/الفرع. Runtime: Docker.
- **Disks → Add Disk**، ثبّته على `/data`، واضبط `SANAD_DB=/data/sanad.db`.
- نفس متغيّرات البيئة أعلاه. Start command يأتي من الحاوية.
- **Settings → Custom Domain** → `staging.os.evcsol.com` → أضِف الـCNAME الذي يعطيك إياه.

## التراجع (Rollback)
احذف/أوقف خدمة الـstaging فقط. خدمة الإنتاج منفصلة تمامًا ولا تتأثر.

---

**الخلاصة:** الكود جاهز للنشر (ثبّتُّ ربط الشبكة + تفعيل حسابات العرض عند الإقلاع).
البوابة الوحيدة هي صلاحية الكتابة على GitHub — فعّلها وأدفع، أو استخدم `railway up` من الحزمة لتتجاوزها.
