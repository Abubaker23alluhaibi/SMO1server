# Delivery System Server

Backend server for Delivery Management System

## 📋 المتغيرات البيئية المطلوبة (Environment Variables)

### ⚠️ متغيرات مطلوبة (Required):

#### 1. `JWT_SECRET` (مطلوب)
**الوصف**: مفتاح سري لتوقيع JWT tokens (لحماية تسجيل الدخول)  
**كيف أنشئه**: 
```bash
# من Terminal (Node.js)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# من PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```
**مثال**: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6`

---

### ✅ متغيرات اختيارية (Optional):

#### 2. `JWT_EXPIRES_IN`
**الوصف**: مدة صلاحية JWT token  
**القيمة الافتراضية**: `7d` (7 أيام)  
**خيارات**: `1h`, `24h`, `7d`, `30d`  
**مثال**: `7d`

#### 3. `NODE_ENV`
**الوصف**: بيئة التشغيل  
**القيم**: `development` أو `production`  
**القيمة الافتراضية**: `development`  
**مثال**: `production`

#### 4. `PORT`
**الوصف**: منفذ الخادم  
**القيمة الافتراضية**: `5000`  
**ملاحظة**: Railway يحدد هذا تلقائياً، لا تحتاج لإضافته

#### 5. `RAILWAY_PUBLIC_DOMAIN`
**الوصف**: Domain العام للـ Railway (لربط الصور)  
**ملاحظة**: Railway يضيف هذا تلقائياً، لكن يمكنك إضافته يدوياً

---

## 🚀 كيفية إضافة المتغيرات في Railway:

### الطريقة الأولى: من Dashboard (الأسهل)

1. **اذهب إلى Railway Dashboard**
   - https://railway.app
   - سجل دخول

2. **اختر المشروع (Project)**
   - اضغط على المشروع الذي أنشأته

3. **اذهب إلى Service**
   - اضغط على Service الخاص بالـ Backend

4. **افتح تبويب Variables**
   - في القائمة الجانبية، اضغط على **Variables**

5. **أضف المتغيرات**
   - اضغط **New Variable**
   - أضف المتغيرات التالية:

   ```
   JWT_SECRET = your-secret-key-here
   JWT_EXPIRES_IN = 7d
   NODE_ENV = production
   ```

6. **احفظ**
   - Railway سيعيد تشغيل الخدمة تلقائياً

### الطريقة الثانية: من Railway CLI

```bash
# تثبيت Railway CLI
npm install -g @railway/cli

# تسجيل الدخول
railway login

# الانتقال إلى مجلد server
cd server

# ربط المشروع
railway link

# إضافة متغيرات
railway variables set JWT_SECRET="your-secret-key-here"
railway variables set JWT_EXPIRES_IN="7d"
railway variables set NODE_ENV="production"
```

---

## 📝 مثال كامل للمتغيرات:

في Railway Dashboard > Variables:

| Variable Name | Value | Required |
|--------------|-------|----------|
| `JWT_SECRET` | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6` | ✅ نعم |
| `JWT_EXPIRES_IN` | `7d` | ❌ لا (افتراضي) |
| `NODE_ENV` | `production` | ❌ لا |

---

## 🔐 إنشاء JWT_SECRET قوي:

### الطريقة 1: من Terminal (Node.js)
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### الطريقة 2: من Terminal (PowerShell)
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

### الطريقة 3: من موقع على الإنترنت
- اذهب إلى: https://randomkeygen.com/
- اختر "CodeIgniter Encryption Keys"
- انسخ أحد المفاتيح

---

## ✅ التحقق من المتغيرات:

بعد إضافة المتغيرات، يمكنك التحقق منها:

```bash
# من Railway CLI
railway variables
```

أو من Dashboard:
- Variables tab > ستظهر جميع المتغيرات

---

## ⚠️ ملاحظات مهمة:

1. **لا تشارك JWT_SECRET** - احتفظ به سراً
2. **استخدم قيم مختلفة** لكل بيئة (development, production)
3. **Railway يعيد التشغيل** تلقائياً عند تغيير المتغيرات
4. **JWT_SECRET يجب أن يكون قوياً** - على الأقل 32 حرف

---

## 🔄 بعد إضافة المتغيرات:

1. Railway سيعيد تشغيل الخدمة تلقائياً
2. انتظر حتى يكتمل النشر
3. تحقق من Logs للتأكد من أن كل شيء يعمل
4. اختبر API من المتصفح: `https://your-app.railway.app/api/health`

---

## 📦 التثبيت والتشغيل:

```bash
# تثبيت المكتبات
npm install

# تشغيل في وضع التطوير
npm run dev

# بناء المشروع
npm run build

# تشغيل في وضع الإنتاج
npm start
```

---

## 🛠️ التقنيات المستخدمة:

- Node.js
- Express.js
- TypeScript
- SQLite
- JWT Authentication
- Multer (لرفع الملفات)

---

## 📄 الرخصة:

MIT

