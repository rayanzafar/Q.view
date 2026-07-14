# نشر سند على بيئة تجريبية (Staging) — بدون المساس بالمنصة القديمة

الهدف: تشغيل النسخة الجديدة على **نفس الدومين برابط مختلف** ليجرّبها الفريق،
مع إبقاء المنصة القديمة على `os.evcsol.com` تعمل كما هي (نسخة احتياطية / Backup).

---

## لماذا نطاق فرعي (subdomain) وليس مسارًا (path)؟

- **`staging.os.evcsol.com` ✅ (المُوصى به):** يعمل فورًا بدون أي تعديل على الكود،
  لأن التطبيق يخدم روابطه من جذر النطاق. المنصة القديمة لا تتأثر إطلاقًا.
- **`os.evcsol.com/sanad` ⚠️:** التطبيق حاليًا يولّد روابط مطلقة (`/app/…`, `/auth/…`)،
  فوضعه تحت مسار فرعي يكسر الروابط. ممكن نضيف دعم `BASE_PATH` إذا أصررت على المسار —
  أخبرني وأضيفه، لكن النطاق الفرعي أنظف وأسرع.

كلاهما «نفس الدومين برابط مختلف». التعليمات أدناه للنطاق الفرعي.

---

## المتطلبات
- خادم لينكس يشغّل `os.evcsol.com` حاليًا (VPS مع nginx)، أو أي خادم تتحكم به.
- **Node.js 22+** (ضروري — نستخدم `node:sqlite` المدمج).
- صلاحية `sudo` وصلاحية تعديل DNS للدومين.

## قبل أي شيء — نسخة احتياطية للمنصة القديمة
```bash
# 1) لقطة لقاعدة بيانات/ملفات المنصة القديمة (عدّل المسار حسب مكانها)
sudo tar -czf ~/evc-prod-backup-$(date +%F).tar.gz /path/to/current/platform
# 2) تأكد أنها تعمل كالمعتاد قبل وبعد — لن نلمسها في هذا الدليل.
```

## الخطوات

### 1) DNS
أضِف سجلًا في مزوّد الدومين:
```
staging  A  <IP خادمك>
```
(نفس IP الخادم الحالي جيد — nginx يفرّق بينهما بـ `server_name`.)

### 2) جلب الكود وتشغيله
```bash
# انسخ سكربت النشر أو نفّذ يدويًا:
sudo mkdir -p /opt/sanad && sudo chown $USER /opt/sanad
git clone --branch claude/evc-platform-analysis-r5nsri https://github.com/rayanzafar/Q.view.git /opt/sanad
cd /opt/sanad/platform
npm ci --omit=dev
npm run seed        # أول مرة فقط — يبني بيانات العرض
```

### 3) ملف الأسرار `.env` (لا يُرفع لـGit أبدًا)
```bash
cat > /opt/sanad/platform/.env <<'EOF'
NODE_ENV=production
PORT=4100
SESSION_SECRET=<ولّد مفتاحًا عشوائيًا طويلًا>
# للمساعد الذكي (اختياري): OPENAI_API_KEY=sk-...
# للبريد الحقيقي (اختياري): MAIL_TRANSPORT=smtp  SMTP_HOST=...  SMTP_USER=...  SMTP_PASS=...
EOF
```

### 4) خدمة systemd (تعمل على المنفذ 4100 — لا تعارض مع القديمة)
```bash
sudo cp deploy/sanad-staging.service /etc/systemd/system/
sudo useradd -r -s /usr/sbin/nologin sanad 2>/dev/null || true
sudo chown -R sanad:sanad /opt/sanad
sudo systemctl daemon-reload
sudo systemctl enable --now sanad-staging
systemctl status sanad-staging     # يجب أن تكون active (running)
```

### 5) nginx — النطاق الفرعي فقط (لا نلمس إعداد os.evcsol.com القديم)
```bash
sudo cp deploy/staging.nginx.conf /etc/nginx/sites-available/sanad-staging.conf
sudo ln -s /etc/nginx/sites-available/sanad-staging.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6) شهادة TLS مجانية
```bash
sudo certbot --nginx -d staging.os.evcsol.com
```

### 7) تحقّق ✅
افتح `https://staging.os.evcsol.com` → سجّل الدخول بأحد حسابات العرض
(`demo.ceo` / `demo.sectorlead` / … كلمة المرور `Sanad@2026`).
المنصة القديمة على `os.evcsol.com` تبقى شغّالة كما هي.

---

## التحديث لاحقًا
```bash
cd /opt/sanad && bash platform/deploy/deploy-staging.sh
```

## التراجع (Rollback) — فوري
```bash
sudo systemctl stop sanad-staging          # أوقف التجريبية
sudo rm /etc/nginx/sites-enabled/sanad-staging.conf && sudo systemctl reload nginx
```
لا شيء من هذا يمسّ المنصة القديمة إطلاقًا.

---

## بدائل الاستضافة
- **Docker:** يوجد `Dockerfile` جاهز — `docker build -t sanad . && docker run -e PORT=4100 -p 4100:4100 --env-file .env sanad`.
- **Railway / Render / Fly:** يوجد `railway.json`؛ اربط المستودع، اضبط المتغيّرات،
  ثم وجّه `staging.os.evcsol.com` (سجل CNAME) إلى الرابط الذي يعطيك إياه المزوّد.
- إن كان `os.evcsol.com` على **cPanel / استضافة مشتركة** بدون Node — أخبرني، الطريقة تختلف.
