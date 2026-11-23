# قانون تاهيرو v8 — دليل التفعيل والنشر خطوة خطوة

> **الإصدار 8.1**: مولّد التمارين (أسئلة ومسائل ونوازل وألغاز من نصوص القوانين)، وصفحات البنود والخصوصية وحذف البيانات بأربع لغات،
> والموافقة على البنود بعد التسجيل وقبل الدخول، وأزرار الصفحات في شاشة البداية والرئيسية. الروابط وأماكنها في المتجرين: القسم 6 أسفله.

هذا الدليل لمن ينشر من الهاتف (Termux) دون حاسوب. كل خطوة شاشةً شاشة، بأسماء الأزرار كما تظهر في المواقع (بالإنجليزية).
النصوص الجاهزة للمتجرين (العنوان والوصف والكلمات المفتاحية وأجوبة استمارات الخصوصية) في [store-listing.md](store-listing.md)،
واللقطات الجاهزة في `dist/store/` داخل الحزمة.

---

## 1) مفتاح Gemini والفوترة المدفوعة (مرة واحدة)

«المساعد» صار يعمل بنموذج **Gemini من Google** عبر Gemini API:
- النموذج السريع `gemini-3.5-flash-lite`: تحضير البحث في النصوص، وشرح «لماذا أخطأت؟»، و«خطتي».
- النموذج الأقوى `gemini-3.8-flash`: الأجوبة، والنوازل، والشرح، والمقارنة، والمواضيع، والنوازل التدريبية، والبطاقات، والشفوي، وقراءة الصور.

**لماذا المستوى المدفوع إلزامي؟** شروط Gemini API تجعل ما يُرسل في المستوى المجاني مادة لتحسين منتجات Google وقابلاً للمراجعة البشرية،
وتمنع إرسال معطيات شخصية فيه، وتفرض المستوى المدفوع على كل تطبيق يصل إلى مستخدمين في أوروبا. وفي المستوى المدفوع لا تستعمل Google
الطلبات ولا الأجوبة لتحسين منتجاتها. والتطبيق يطلب أيضاً في كل استدعاء ألا يُحفظ الطلب في سجلات مشروعك (`store: false`).

### أ) إنشاء المفتاح
1. افتح في Chrome: **aistudio.google.com** وادخل بحساب Google الذي تريد أن تُنسب إليه الفوترة.
2. من القائمة الجانبية: **Dashboard** ← **API keys** ← زر **Create API key**.
3. اختر المشروع (أو اترك المشروع الذي ينشئه AI Studio تلقائياً) ← **Create key**.
4. انسخ المفتاح كاملاً (يبدأ عادةً بـ `AQ.`). لا ترسله لأحد، ولا تضعه في أي ملف: يُدخل فقط في أمر النشر بإدخال مخفي.
5. إن ظهرت بجانب المفتاح كلمة **Unrestricted**: مرّر الإصبع عليها ← **Add restrictions** ← **Restrict to Gemini API only** ← **Restrict key**
   (المفاتيح غير المقيدة يرفضها Gemini API).

### ب) تفعيل الفوترة (Prepay بـ 5 دولارات على الأقل)
1. في AI Studio: **Dashboard** ← **Projects**. في عمود **Billing Tier** أمام مشروعك اضغط **Set up billing**.
2. إن لم يكن لديك حساب فوترة في Google: اختر البلد **Morocco** ووافق على الشروط، ثم أكمل معلومات الاتصال وأضف بطاقة الدفع.
3. اختر **Prepay** إن خُيّرت، ثم **Buy credits**: 5 دولارات تكفي لبضع مئات من الأجوبة (الجواب الواحد بين سنت وسنتين تقريباً حتى 31 دجنبر 2026،
   ويتضاعف سعر Gemini 3.8 Flash ابتداءً من فاتح يناير 2027؛ وما يُعاد من الذاكرة مجاني).
   - الرصيد المدفوع مسبقاً ينتهي بعد 12 شهراً من شرائه، ولا يُسترد.
   - رصيد Google Cloud المجاني (300 دولار) **لا يُقبل** لـ Gemini API.
4. تحقق: في صفحة **Projects** يظهر في **Billing Tier** المستوى المدفوع (Tier 1) بدل Free.
5. سقف الإنفاق (مستحسن): صفحة **Spend** ← **Monthly spend cap** ← **Edit spend cap** ← مثلاً 10 دولارات.
6. السجلات: افتح **aistudio.google.com/logs** ← اختر المشروع ← **Settings** ← أطفئ تسجيل **generateContent**
   (التطبيق يطلب عدم الحفظ في كل استدعاء أصلاً؛ وهذا احتياط إضافي).

**إذا نفد الرصيد**: كل الطلبات تُرفض (خطأ 402)، فيظهر للطالب «تعذّر الجواب الآن» دون أن يُخصم من رصيده اليومي،
وتكتب لوحة المؤلف السبب. اشحن من **Billing** ← **Buy credits** فيعود «المساعد» فوراً دون إعادة نشر.

**الحماية من المفاجآت**: أداة النشر تضبط حداً عاماً قدره 600 طلب في اليوم لكل التطبيق (`QT_AI_DAILY_BUDGET`)،
وحداً لكل طالب (12 للمجهول و40 لحساب Google). لرفع الحد العام لاحقاً: أضف `QT_AI_DAILY_BUDGET=1500` قبل أمر النشر.

---

## 2) نشر الخادم والموقع والدفع إلى GitHub

الأمر الكامل في رسالة التسليم. أثناء النشر يُسأل عن `GEMINI_API_KEY` بإدخال مخفي (لا يظهر ما تكتبه)،
ويُفحص المفتاح بطلب صغير جداً قبل حفظه:
- «✓ مفتاح Gemini يعمل»: كل شيء سليم.
- «مفتاح Gemini مرفوض»: انسخه من جديد من AI Studio، وتأكد أنه مقيد بـ Gemini API.
- «رصيد الدفع المسبق فارغ (402)»: أكمل الخطوة 1-ب ثم أعد الأمر.
- مفتاح Claude القديم (`ANTHROPIC_API_KEY`) يُحذف من الخادم تلقائياً.

وفي آخر النشر يسأل حساب مجهول حقيقي «المساعد» سؤالاً من المكتبة، فيظهر «✓ المساعد أجاب من المكتبة».

---

## 3) أندرويد — Google Play

البناء يجري في GitHub Actions عند كل دفع إلى main (أسرار التوقيع مضبوطة منذ v5). النسخة 8.0.x.

1. **تنزيل الحزمة**: github.com ← المستودع ← **Actions** ← آخر تشغيل لـ **Android** (علامة ✓ خضراء) ← أسفل الصفحة **Artifacts** ←
   `qanoun-tahiro-8.0.…` (ملف zip فيه APK للتثبيت المباشر وAAB لـ Google Play).
2. **Play Console** (play.google.com/console) من Chrome بوضع «موقع سطح المكتب»:
   - إن لم يكن التطبيق منشأً: **Create app** ← الاسم «قانون تاهيرو» ← اللغة الافتراضية العربية ← App ← Free ← وافق على الإقرارات.
   - **Test and release** ← **Production** (أو **Closed testing** أولاً، انظر أسفله) ← **Create new release** ← ارفع ملف ‎.aab ← **Next** ← **Save** ← **Send for review**.
3. **صفحة المتجر** (**Grow users** ← **Store presence** ← **Main store listing**): العنوان والوصفان من store-listing.md،
   والأيقونة `dist/store/play-icon-512.png`، وصورة العرض `dist/store/play-feature-1024x500.png`، واللقطات `dist/store/android/01…08`.
4. **App content** (أسفل القائمة **Policy and programs** ← **App content**):
   - **Privacy policy**: `https://qanon-47831.web.app/privacy`
   - **Data safety** ← في آخرها **Data deletion** ← **Delete account URL**: `https://qanon-47831.web.app/delete-data`
   - **Ads**: Yes, my app contains ads.
   - **App access**: All functionality is available without special access (الدخول باسم مستعار دون كلمة مرور).
   - **Content rating**: الاستمارة (IARC) بأجوبة store-listing.md.
   - **Target audience and content**: اختر **18 and over** وحدها (شرط شروط Gemini API).
   - **Data safety**: الأجوبة الجاهزة في store-listing.md (ومنها: الصور والتسجيلات تُعالَج لحظياً ولا تُحفظ).
   - **Government apps / Financial features / Health / News**: No.
5. **حسابات المطورين الشخصية المنشأة بعد 13 نونبر 2023**: يلزم اختبار مغلق (**Closed testing**) مع 12 مختبراً على الأقل
   بقوا مشتركين 14 يوماً متصلة، ثم من **Dashboard** ← **Apply for production**. أضف المختبرين بقائمة بريد (Google Groups أو قائمة في Console)،
   وأرسل لهم رابط الاشتراك الذي تعطيه صفحة الاختبار.

**الميكروفون في أندرويد**: يُطلب إذنه حين يضغط الطالب «أجب بصوتك» أول مرة فقط. والكاميرا لا تحتاج إذناً: «التقط صورة» تفتح تطبيق الكاميرا في النظام.

---

## 4) iPhone — App Store (دون Mac)

البناء يجري على Mac من GitHub (`.github/workflows/ios.yml`) ويُرفع إلى TestFlight. قبل الأسرار ينجح بناء للمحاكي فقط (يثبت أن المشروع سليم).
نسخة iPhone بلا إعلانات ولا إحصاءات ولا تتبع.

### أ) حساب Apple Developer (مرة واحدة، 99 دولاراً في السنة)
1. **developer.apple.com/programs/enroll** ← **Start your enrollment** ← ادخل بحساب Apple (يلزم تفعيل التحقق بخطوتين).
2. اختر **Individual / Sole Proprietor**، وأكمل الاسم كما في بطاقة التعريف والعنوان، ثم ادفع.
   الموافقة تستغرق عادةً من ساعات إلى يومين؛ يصلك بريد «Welcome to the Apple Developer Program».

### ب) معرّف التطبيق
**developer.apple.com/account** ← **Certificates, IDs & Profiles** ← **Identifiers** ← **+** ← **App IDs** ← **App** ← Continue:
- Description: `Qanoun Tahiro`
- Bundle ID: **Explicit** ← `com.qanontahiro.app`
- Capabilities: لا شيء ← **Continue** ← **Register**.

### ج) الشهادة (من Termux)
1. في Termux:
   ```
   pkg install -y openssl-tool gh python
   cd ~/qanoun-tahiro && bash scripts/ios-signing.sh csr
   ```
   يُنشئ مفتاحاً خاصاً في `~/.qanoun-tahiro-ios` وطلب شهادة في Download: `qanoun-tahiro.certSigningRequest`.
2. في المتصفح: **Certificates** ← **+** ← **Apple Distribution** ← Continue ← **Choose File** ← اختر الملف من Download ← Continue ← **Download**
   (ينزل `distribution.cer` إلى Download).
3. ⚠ احفظ نسخة من المجلد `~/.qanoun-tahiro-ios` خارج الهاتف (مثلاً في Google Drive): الشهادة لا تعمل دون مفتاحها.

### د) ملف التعريف (Profile)
**Profiles** ← **+** ← تحت Distribution: **App Store Connect** ← Continue ← App ID: `com.qanontahiro.app` ← Continue ←
اختر الشهادة التي أنشأتها للتو ← Continue ← Provisioning Profile Name: `Qanoun Tahiro App Store` ← **Generate** ← **Download**.

### هـ) التطبيق في App Store Connect
**appstoreconnect.apple.com** ← **Apps** ← **+** ← **New App**:
- Platforms: iOS · Name: `قانون تاهيرو` · Primary Language: **Arabic** · Bundle ID: `com.qanontahiro.app` · SKU: `qanontahiro` · User Access: Full Access ← **Create**.

### و) مفتاح App Store Connect API (للرفع الآلي إلى TestFlight)
**Users and Access** ← **Integrations** ← **App Store Connect API** ← **Team Keys** ← **+** (أو **Request Access** أول مرة) ←
Name: `GitHub Actions` · Access: **App Manager** ← **Generate** ← **Download API Key** (يُنزَّل **مرة واحدة فقط**: `AuthKey_XXXXXXXXXX.p8`).
انسخ أيضاً **Issuer ID** الظاهر أعلى الصفحة.

### ز) الأسرار في GitHub (من Termux)
```
cd ~/qanoun-tahiro && bash scripts/ios-signing.sh check && bash scripts/ios-signing.sh secrets
```
يتحقق أن الشهادة تطابق المفتاح، وأن ملف التعريف للمعرّف الصحيح ويحوي الشهادة، ثم يسألك عن **Issuer ID** ورمز GitHub،
ويضبط ستة أسرار: `IOS_CERT_P12` `IOS_CERT_PASSWORD` `IOS_PROFILE` `ASC_KEY_ID` `ASC_ISSUER_ID` `ASC_KEY_P8`.
بعد النجاح احذف `AuthKey_*.p8` من Download (بعد حفظ نسخة في مكان آمن).

### ح) البناء والرفع
GitHub ← **Actions** ← **iOS** ← **Run workflow** ← (اترك «ارفع البناء إلى TestFlight» مفعّلاً) ← **Run workflow**.
بعد 15–30 دقيقة يظهر البناء في App Store Connect ← التطبيق ← **TestFlight** (حالة «Processing» ثم «Ready»).
- لتجربته على iPhone: **TestFlight** ← **Internal Testing** ← **+** ← أضف نفسك ← ثبّت تطبيق TestFlight من App Store وافتح الدعوة.

### ط) الإرسال للمراجعة
App Store Connect ← التطبيق ← النسخة 8.0.0:
- **Screenshots** ← **iPhone 6.9" Display**: ارفع `dist/store/iphone/01…08` (1290×2796).
- النصوص (Subtitle، Promotional Text، Description، Keywords) من store-listing.md.
- Support URL: `https://qanon-47831.web.app` · Privacy Policy URL: `https://qanon-47831.web.app/privacy`.
- **Build** ← اختر البناء من TestFlight.
- **App Information** ← **Age Ratings** ← **Set Up Age Ratings**: أجب بصدق، ثم في **Override to Higher Age Rating** اختر **18+**
  (شروط Gemini API تقصر «المساعد» على من بلغ 18 سنة).
- **App Privacy** ← **Get Started**: الأجوبة الجاهزة في store-listing.md (لا تتبع).
- **App Review Information**: Sign-in required: **No**، ومعلومات المراجِع في store-listing.md.
- **Add for Review** ← **Submit**.

**تنبيه مراجعة Apple (الإرشاد 4.8)**: التطبيق يعرض «الدخول بـ Google»، ويعرض معه الدخول باسم مستعار دون بريد ولا اسم؛
وهذا بديل يحفظ الخصوصية. إن طلبت Apple مع ذلك «Sign in with Apple» فأخبرني لأضيفه في تحديث.

---

## 5) ما الجديد في v8 (للطالب)
- **«المساعد» بنموذج Gemini**، بعشر أدوات: اسأل (محادثة متصلة)، صوّر سؤالاً، نازلة، اشرح مادة، قارن، الموضوع، نازلة تدريبية، بطاقات، الشفوي (كتابةً أو بالصوت)، خطتي.
- **النصوص القانونية داخل التطبيق**: 27 قانوناً و7452 مادة، بحث في كل النصوص، ورقم المادة، والمحفوظات، وأزرار «اشرح» و«بطاقات» و«أسئلة البنك» على كل مادة،
  و«نص المادة» تحت كل سؤال من البنك.
- **تطبيق iPhone** إلى جانب أندرويد والموقع.
- تأكيد السن (18 سنة فأكثر) قبل أول استعمال للمساعد.

---

## 6) الإصدار 8.1: ما الجديد، وأين تضع الروابط

### للطالب
- **ولّد تمارين** (أول أدوات «المساعد»، وعلى كل مادة وكل قانون في «النصوص القانونية»): أسئلة أو مسائل أو نوازل أو ألغاز أو مزيج منها،
  3 أو 5 تمارين، سهلة أو متوسطة أو صعبة، من مادة بعينها أو من قانون كامل أو من المكتبة كلها. بصيغة البنك وقواعده نفسها، وتعليل لكل خيار
  و«نص المادة»، وتُلعب مثل أسئلة البنك؛ ولا تُحتسب في النقاط ولا في الترتيب. كل توليد يخصم طلباً واحداً من رصيد «المساعد».
- **البنود والشروط** تظهر بعد التسجيل وقبل الدخول (مرة واحدة على كل جهاز، ومن جديد إن تغيّرت البنود)، ولا يدخل من لا يوافق.
- أزرار **البنود والشروط** و**سياسة الخصوصية** و**حذف البيانات** أسفل شاشة الدخول وأسفل الرئيسية (فوق الشريط الإعلاني)، وفي الإعدادات،
  وتُفتح في المتصفح.

### الروابط (أربع لغات في كل صفحة: العربية والإنجليزية والفرنسية والإسبانية)
| الصفحة | الرابط |
|---|---|
| البنود والشروط | `https://qanon-47831.web.app/terms` |
| سياسة الخصوصية | `https://qanon-47831.web.app/privacy` |
| حذف الحساب والبيانات | `https://qanon-47831.web.app/delete-data` |

### Google Play Console
1. **Policy and programs** ← **App content** ← **Privacy policy** ← **Start** (أو **Manage**) ← الصق رابط الخصوصية ← **Save**.
2. **App content** ← **Data safety** ← **Start** (أو **Manage**) ← تابع الأجوبة كما في `docs/store-listing.md` ← في صفحة **Data deletion**:
   أجب **Yes** عن طلب الحذف، والصق في **Delete account URL** رابط حذف البيانات ← **Next** ← **Save**.
3. إن كانت الاستمارة مرسلة من قبل: لا نوع جديداً من المعطيات في 8.1 (الموافقة على البنود جزء من التقدم المعلن، والتمارين المولَّدة لا تُحفظ)؛
   يكفي إضافة رابط الحذف.

### App Store Connect
1. **App Privacy** ← **Privacy Policy** ← **Edit** ← الصق رابط الخصوصية ← **Save**.
2. رابط البنود مذكور في آخر الوصف (النصوص الجاهزة في `docs/store-listing.md`). اترك **License Agreement** على اتفاقية Apple القياسية.

> البنود صيغت بعناية للتطبيق كما هو، لكنها ليست رأياً قانونياً: يُستحسن أن يراجعها محامٍ قبل النشر الواسع. وصفحة الحذف تَعِد بحذف الحسابات
> التي فُقد رمزها خلال 30 يوماً من التحقق؛ فتابع بريد التواصل في صفحة المتجر.
