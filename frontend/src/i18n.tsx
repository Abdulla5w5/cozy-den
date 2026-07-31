import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'ar';
type Vars = Record<string, string | number>;

// EN = plain English. AR = Arabic with a light Kuwaiti dialect flavour.
const dict: Record<string, { en: string; ar: string }> = {
  // ---- nav / footer ----
  'nav.home': { en: 'Home', ar: 'الرئيسية' },
  'nav.games': { en: 'Games', ar: 'الألعاب' },
  'nav.menu': { en: 'Menu', ar: 'المنيو' },
  'nav.staff': { en: 'Staff', ar: 'الموظفون' },
  'nav.login': { en: 'Log in', ar: 'تسجيل دخول' },
  'nav.logout': { en: 'Log out', ar: 'تسجيل خروج' },
  'brand.home': { en: 'Cozy Den home', ar: 'الصفحة الرئيسية لكوزي دن' },
  'lang.switch': { en: 'Switch language', ar: 'غيّر اللغة' },
  'theme.dark': { en: 'Switch to dark mode', ar: 'فعّل الوضع الليلي' },
  'theme.light': { en: 'Switch to light mode', ar: 'فعّل الوضع النهاري' },
  'brand.logoAlt': { en: 'Cozy Den Board Game Cafe', ar: 'شعار كوزي دن كافيه ألعاب البورد' },
  'home.hero.move': { en: 'Your move.', ar: 'دورك.' },
  'home.hero.people': { en: 'Your people.', ar: 'ربعك.' },
  'home.hero.den': { en: 'Your den.', ar: 'مكانك.' },
  'home.proof.title': { en: 'Good nights start here.', ar: 'سهرتكم الحلوة تبدأ من هني.' },
  'home.proof.sub': {
    en: 'Board games, bites & your favorite people.',
    ar: 'ألعاب بورد، أكل لذيذ، وربعكم.',
  },
  'home.play': { en: 'Play', ar: 'العب' },
  'home.more': { en: 'More', ar: 'أكثر' },
  'home.sticker.games': { en: 'games', ar: 'لعبة' },
  'home.stageLabel': { en: 'Cozy Den game night', ar: 'ليلة ألعاب في كوزي دن' },
  'home.noRulebook': { en: 'No rulebook needed', ar: 'ما يحتاج تقرون كتاب القوانين' },
  'home.ctaLine1': { en: 'Bring the crew.', ar: 'جيبوا الربع.' },
  'home.ctaLine2': { en: 'We’ll bring the games.', ar: 'والألعاب علينا.' },
  'footer.tagline': {
    en: 'Board games, great food, and good company — nightly.',
    ar: 'ألعاب بورد، أكل يونس، وجمعة حلوة — كل ليلة.',
  },
  'footer.visit': { en: 'Visit', ar: 'زورونا' },
  'footer.book': { en: 'Book a table', ar: 'احجز طاولة' },
  'footer.library': { en: 'Game library', ar: 'مكتبة الألعاب' },
  'footer.food': { en: 'Food & drink', ar: 'أكل وشرب' },
  'footer.cafe': { en: 'Café', ar: 'الكافيه' },
  'footer.location': { en: 'Location', ar: 'الموقع' },
  'footer.contact': { en: 'Contact', ar: 'تواصل معنا' },
  'footer.dashboard': { en: 'Dashboard', ar: 'لوحة التحكم' },
  'footer.instagram': { en: 'Cozy Den on Instagram', ar: 'كوزي دن على إنستقرام' },
  'footer.legal': {
    en: '© 2026 Cozy Den Board Game Café · Prototype — payments & email are stubbed.',
    ar: '© 2026 كوزي دن · نسخة تجريبية — الدفع والإيصالات حالياً للتجربة.',
  },

  // ---- home ----
  'home.eyebrow': { en: 'The ultimate midnight social hub', ar: 'جمعتكم الليلية غير' },
  'home.title.a': { en: 'Where every', ar: 'كل' },
  'home.title.move': { en: 'move', ar: 'نقلة' },
  'home.title.b': { en: 'matters, and every', ar: 'تفرق، وكل' },
  'home.title.game': { en: 'game', ar: 'لعبة' },
  'home.title.c': { en: 'tells a story.', ar: 'لها قصة.' },
  'home.sub': {
    en: 'Book a 2-hour table session online, then pick from 100+ tabletop games and order great food when you arrive. Your den, your rules.',
    ar: 'احجز طاولتك ساعتين أونلاين، ولما توصل اختار من أكثر من ١٠٠ لعبة واطلب اللي يعجبك. المكان مكانكم والجو جوّكم.',
  },
  'home.claim': { en: 'Claim Your Table', ar: 'احجز طاولتك' },
  'home.explore': { en: 'Explore Games', ar: 'تصفّح الألعاب' },
  'home.stat.games': { en: 'Games on shelf', ar: 'لعبة على الرف' },
  'home.stat.tables': { en: 'Cozy tables', ar: 'طاولات حق جمعتكم' },
  'home.stat.hours': { en: '2pm–3am', ar: '٢ الظهر – ٣ الفجر' },
  'home.stat.hoursSub': { en: 'Last seating 1am', ar: 'آخر جلسة الساعة ١' },
  'home.how': { en: 'How it works', ar: 'شلون تحجز؟' },
  'home.howSub': {
    en: 'Four steps from craving to checkmate.',
    ar: 'أربع خطوات من اختيار الطاولة إلى أول نقلة.',
  },
  'home.step1': { en: 'Pick a table', ar: 'اختار طاولتك' },
  'home.step1b': {
    en: 'Pick a date and any 30-minute start time for a 2-hour session.',
    ar: 'حدد اليوم والوقت اللي يناسبكم؛ كل جلسة ساعتين والبدايات كل نص ساعة.',
  },
  'home.step2': { en: 'Pay the holding fee', ar: 'ثبّت حجزك' },
  'home.step2b': {
    en: 'A small table-holding fee secures your session.',
    ar: 'ادفع رسوم الحجز البسيطة ونضمن لكم الطاولة.',
  },
  'home.step3': { en: 'Show your code', ar: 'ورّنا الكود' },
  'home.step3b': {
    en: 'Flash your booking code at the counter when you arrive.',
    ar: 'لما توصل، ورّنا كود الحجز عند الكاونتر.',
  },
  'home.step4': { en: 'Play & order there', ar: 'اختاروا اللعبة واطلبوا' },
  'home.step4b': {
    en: 'Pick any game from the shelf and order from the counter.',
    ar: 'اختاروا لعبتكم من الرف واطلبوا اللي يعجبكم من الكاونتر.',
  },
  'home.popular': { en: 'Popular games', ar: 'الألعاب الأكثر طلباً' },
  'home.seeAll': { en: 'See all →', ar: 'شوف الكل ←' },
  'home.onMenu': { en: 'On the menu', ar: 'من منيو كوزي دن' },
  'home.fullMenu': { en: 'Full menu →', ar: 'المنيو الكامل ←' },
  'home.ctaTitle': { en: 'Your table is waiting.', ar: 'طاولتك تنتظرك.' },
  'home.ctaSub': {
    en: "Grab a seating before they're gone tonight.",
    ar: 'ثبّتوا حجزكم قبل لا تمتلي الطاولات الليلة.',
  },
  'home.book': { en: 'Book a Table', ar: 'احجز طاولة' },
  'players': { en: 'players', ar: 'لاعبين' },

  // ---- games ----
  'games.eyebrow': { en: 'The library', ar: 'المكتبة' },
  'games.title': { en: 'The Vault', ar: 'الخزنة' },
  'games.sub': {
    en: 'From high-stakes strategy to midnight party chaos. Pick your poison and let the games begin.',
    ar: 'من الاستراتيجية الثقيلة لفوضى السهرة. اختر لعبتك وخل السوالف تبدأ.',
  },
  'games.all': { en: 'All', ar: 'الكل' },
  'games.featured': { en: 'Featured', ar: 'مميّزة' },
  'games.trending': { en: 'Trending', ar: 'رايجة' },
  'games.book': { en: 'Book →', ar: 'احجز ←' },
  'games.showing': { en: 'Showing {n} of {total} games', ar: 'عارض {n} من {total} لعبة' },
  'flavor.Strategy': {
    en: 'Brains over brawn — outwit every rival at the table. 🧠',
    ar: 'عقل وتخطيط — خل تفكيرك يغلبهم. 🧠',
  },
  'flavor.Family': {
    en: 'Easy to learn, impossible to put down.',
    ar: 'سهلة وتحبس — ما تقدر تتركها.',
  },
  'flavor.Party': {
    en: 'Loud, chaotic, and a guaranteed blast! 🎉',
    ar: 'صياح وونس ومضمونة تكسر السهرة! 🎉',
  },
  'flavor.Cooperative': {
    en: 'Win together or lose together — no pressure. 🤝',
    ar: 'تربحون سوا أو تخسرون سوا — عادي. 🤝',
  },
  'flavor.Abstract': {
    en: 'Elegant, tactile, delightfully mind-bending.',
    ar: 'أنيقة وتلعب بمخك، حلوة وايد.',
  },
  'flavor.default': {
    en: 'A cozy-night favourite worth a spin. ✨',
    ar: 'لعبة تونس، تستاهل تجربها. ✨',
  },

  // ---- menu ----
  'menu.eyebrow': { en: 'The provisions', ar: 'المونة' },
  'menu.title': { en: 'The Provision Menu', ar: 'منيو المونة' },
  'menu.sub': {
    en: 'Fuel your focus and satisfy the squad with our curated selection of high-energy snacks and refreshing beverages.',
    ar: 'عبّي طاقتك ورضّي الجمعة بأكلنا اللذيذ ومشروباتنا المنعشة.',
  },
  'menu.all': { en: 'All Items', ar: 'الكل' },
  'menu.food': { en: 'Food', ar: 'أكل' },
  'menu.drink': { en: 'Drinks', ar: 'مشروبات' },
  'menu.foodTitle': { en: 'Food', ar: 'الأكل' },
  'menu.drinkTitle': { en: 'Drinks', ar: 'المشروبات' },
  'menu.add': { en: 'Add to Den →', ar: 'أضفها للطلب ←' },
  'menu.ctaTitle': { en: 'Hungry yet?', ar: 'جوعان؟' },
  'menu.ctaSub': {
    en: 'Order at the counter when you arrive — your table will be ready.',
    ar: 'اطلب من الكاونتر لين توصل — طاولتك بتكون جاهزة.',
  },
  'menu.book': { en: 'Book a Table', ar: 'احجز طاولة' },

  // ---- booking flow ----
  'bk.table': { en: 'Table', ar: 'طاولة' },
  'bk.game': { en: 'Game', ar: 'لعبة' },
  'bk.menu': { en: 'Menu', ar: 'منيو' },
  'bk.checkout': { en: 'Checkout', ar: 'الدفع' },
  'bk.s1title': { en: '1. Pick a date & table', ar: '١. اختر التاريخ والطاولة' },
  'bk.date': { en: 'Date', ar: 'التاريخ' },
  'bk.seats': { en: '{n} seats', ar: '{n} كراسي' },
  'bk.nextGame': { en: 'Next: choose a game', ar: 'التالي: اختر لعبة' },
  'bk.sessionHint': {
    en: 'Every booking is a 2-hour session. After-midnight times belong to the evening you select.',
    ar: 'كل حجز ساعتين. أوقات بعد نص الليل تتبع الليلة اللي اخترتها.',
  },
  'bk.s2checkout': { en: '2. Your details & payment', ar: '٢. بياناتك والدفع' },
  'bk.s2title': { en: '2. Pick a game (optional)', ar: '٢. اختر لعبة (اختياري)' },
  'bk.noGame': { en: 'No game', ar: 'بدون لعبة' },
  'bk.justTable': { en: 'Just the table', ar: 'بس الطاولة' },
  'bk.back': { en: 'Back', ar: 'رجوع' },
  'bk.nextFood': { en: 'Next: food & drink', ar: 'التالي: الأكل والشرب' },
  'bk.s3title': { en: '3. Pre-order food & drink (optional)', ar: '٣. اطلب أكل وشرب مقدماً (اختياري)' },
  'bk.nextDetails': { en: 'Next: your details', ar: 'التالي: بياناتك' },
  'bk.s4title': { en: '4. Your details & payment', ar: '٤. بياناتك والدفع' },
  'bk.summary': { en: 'Booking summary', ar: 'ملخص الحجز' },
  'bk.seating': { en: '(2-hour seating)', ar: '(فترة ساعتين)' },
  'bk.gameLabel': { en: 'Game:', ar: 'اللعبة:' },
  'bk.none': { en: 'None', ar: 'بدون' },
  'bk.tableFee': { en: 'Table reservation fee', ar: 'رسوم حجز الطاولة' },
  'bk.total': { en: 'Total:', ar: 'الإجمالي:' },
  'bk.name': { en: 'Name', ar: 'الاسم' },
  'bk.email': { en: 'Email', ar: 'الإيميل' },
  'bk.paySecure': {
    en: 'You’ll be taken to a secure page to pay by KNET or card. Your booking is held while you pay.',
    ar: 'بننقلك لصفحة دفع آمنة تدفع فيها بالكي نت أو البطاقة. حجزك محفوظ لين تخلص الدفع.',
  },
  'bk.payFailed': {
    en: 'Payment didn’t go through, so the table wasn’t booked. You can try again.',
    ar: 'الدفع ما تم، فما انحجزت الطاولة. تقدر تحاول مرة ثانية.',
  },
  'bk.payError': {
    en: 'We couldn’t confirm the payment. If you were charged, contact us and we’ll sort it out.',
    ar: 'ما قدرنا نتأكد من الدفع. إذا انخصم منك مبلغ، تواصل معنا ونحلها.',
  },
  'bk.payPending': {
    en: 'Your payment is still being confirmed. Check your bookings in a moment.',
    ar: 'دفعتك لسه قيد التأكيد. راجع حجوزاتك بعد شوي.',
  },
  'bk.pay': { en: 'Pay {amount} & book', ar: 'ادفع {amount} واحجز' },
  'bk.processing': { en: 'Processing…', ar: 'جاري المعالجة…' },
  'bk.wrong': { en: 'Something went wrong.', ar: 'صار في خطأ.' },

  // ---- confirmation ----
  'conf.title': { en: 'Booking confirmed!', ar: 'تم تأكيد الحجز!' },
  'conf.emailed': {
    en: 'A receipt has been emailed to {email} (stubbed in this prototype).',
    ar: 'انرسل الإيصال على {email} (تجريبي بهالنسخة).',
  },
  'conf.show': { en: 'Show this code at the counter', ar: 'وري هذا الكود عند الكاونتر' },
  'conf.game': { en: 'Game:', ar: 'اللعبة:' },
  'conf.noneSel': { en: 'None selected', ar: 'ما تم اختيار لعبة' },
  'conf.totalPaid': { en: 'Total paid:', ar: 'المبلغ المدفوع:' },
  'conf.another': { en: 'Make another booking', ar: 'احجز مرة ثانية' },
  'loading': { en: 'Loading…', ar: 'جاري التحميل…' },

  // ---- staff ----
  'staff.title': { en: 'Staff login', ar: 'دخول الموظفين' },
  'staff.password': { en: 'Password', ar: 'كلمة السر' },
  'staff.signin': { en: 'Sign in', ar: 'دخول' },
  'staff.signing': { en: 'Signing in…', ar: 'جاري الدخول…' },
  'staff.dashboard': { en: 'Dashboard', ar: 'لوحة التحكم' },
  'staff.signedInAs': { en: 'Signed in as {name}', ar: 'مسجّل دخول باسم {name}' },
  'staff.today': { en: "Today's bookings", ar: 'حجوزات اليوم' },
  'staff.analytics': { en: 'Monthly analytics', ar: 'إحصائيات الشهر' },
  'staff.checkinPh': { en: 'Enter code to check in', ar: 'اكتب الكود لتسجيل الحضور' },
  'staff.checkin': { en: 'Check in', ar: 'تسجيل حضور' },
  'staff.noBookings': { en: 'No bookings for this date.', ar: 'ما في حجوزات بهذا التاريخ.' },
  'staff.time': { en: 'Time', ar: 'الوقت' },
  'staff.code': { en: 'Code', ar: 'الكود' },
  'staff.guest': { en: 'Guest', ar: 'الضيف' },
  'staff.order': { en: 'Order', ar: 'الطلب' },
  'staff.status': { en: 'Status', ar: 'الحالة' },
  'staff.month': { en: 'Month', ar: 'الشهر' },
  'staff.bookings': { en: 'Bookings', ar: 'الحجوزات' },
  'staff.revenue': { en: 'Revenue', ar: 'الإيرادات' },
  'staff.popularGames': { en: 'Popular games', ar: 'الألعاب المشهورة' },
  'staff.peak': { en: 'Peak time slots', ar: 'أوقات الذروة' },
  'staff.utilization': { en: 'Table utilization', ar: 'استخدام الطاولات' },
  'staff.emptyGames': { en: 'No game bookings yet.', ar: 'ما في حجوزات ألعاب بعد.' },
  'staff.emptyBookings': { en: 'No bookings yet.', ar: 'ما في حجوزات بعد.' },
  'staff.noTables': { en: 'No tables.', ar: 'ما في طاولات.' },

  // ---- auth page ----
  'auth.h1a': { en: 'Where strategy', ar: 'وين' },
  'auth.h1b': { en: 'meets the midnight', ar: 'تلتقي الاستراتيجية' },
  'auth.h1c': { en: 'hour.', ar: 'بمنتصف الليل.' },
  'auth.sub': {
    en: 'Claim your spot at the table — sign in to manage your Cozy Den.',
    ar: 'احجز مكانك عالطاولة — سجّل دخولك وتحكّم بحجوزاتك في كوزي دن.',
  },
  'auth.stat1k': { en: 'Cozy tables', ar: 'طاولات مريحة' },
  'auth.stat1v': { en: '8 tables', ar: '٨ طاولات' },
  'auth.stat2k': { en: 'Games on shelf', ar: 'ألعاب على الرف' },
  'auth.stat2v': { en: '100+ titles', ar: '+١٠٠ لعبة' },
  'auth.signin': { en: 'Sign In', ar: 'تسجيل دخول' },
  'auth.join': { en: 'Join Den', ar: 'انضم للدن' },
  'auth.emailPh': { en: 'player@cozyden.com', ar: 'player@cozyden.com' },
  'auth.username': { en: 'Username', ar: 'اسم المستخدم' },
  'auth.usernamePh': { en: 'DenMaster99', ar: 'DenMaster99' },
  'auth.forgot': { en: 'Forgot?', ar: 'نسيت؟' },
  'auth.enter': { en: 'Enter the Den', ar: 'ادخل الدن' },
  'auth.create': { en: 'Create Account', ar: 'إنشاء حساب' },
  'auth.quick': { en: 'Quick Connect', ar: 'دخول سريع' },
  'auth.google': { en: 'Google', ar: 'جوجل' },
  'auth.discord': { en: 'Discord', ar: 'ديسكورد' },
  'auth.soon': {
    en: 'Customer accounts are coming soon — staff can sign in on the Sign In tab.',
    ar: 'حسابات العملاء قريباً — الموظفين يسجلون دخول من تبويب «تسجيل دخول».',
  },
  'auth.socialSoon': {
    en: "Social sign-in isn't available in this prototype yet.",
    ar: 'الدخول عبر الحسابات الاجتماعية مو متوفر بهالنسخة.',
  },

  // ---- account / my bookings ----
  'nav.register': { en: 'Register', ar: 'سجّل' },
  'nav.mybookings': { en: 'My Bookings', ar: 'حجوزاتي' },
  'acct.title': { en: 'My Bookings', ar: 'حجوزاتي' },
  'acct.sub': { en: 'Your past and upcoming sessions.', ar: 'جلساتك السابقة والقادمة.' },
  'acct.empty': { en: "You haven't booked anything yet.", ar: 'ما حجزت شي بعد.' },
  'staff.imgSharePage': {
    en: 'That is a share page, not an image. Drive, Docs, Dropbox and OneDrive links serve a web page, so the picture will not appear. Upload to a free image host (Cloudinary works well) and paste the direct link — it should end in .jpg, .png or .webp.',
    ar: 'هذا رابط صفحة مشاركة مو صورة. روابط درايف ودروب بوكس تفتح صفحة ويب، فالصورة ما راح تظهر. ارفع الصورة على استضافة صور مجانية (مثل Cloudinary) والصق الرابط المباشر — لازم ينتهي بـ .jpg أو .png أو .webp.',
  },
  'staff.imgBad': {
    en: 'This link did not load as an image. Check it opens the picture directly in a browser, with no page around it.',
    ar: 'الرابط ما فتح كصورة. تأكد إنه يفتح الصورة مباشرة بالمتصفح بدون صفحة حولها.',
  },
  // ---- wanted board / about (batch 3) ----
  'nav.wanted': { en: 'Wanted Board', ar: 'لوحة الطلبات' },
  'nav.about': { en: 'About Us', ar: 'من نحن' },
  'day.sun': { en: 'Sun', ar: 'الأحد' },
  'day.mon': { en: 'Mon', ar: 'الاثنين' },
  'day.tue': { en: 'Tue', ar: 'الثلاثاء' },
  'day.wed': { en: 'Wed', ar: 'الأربعاء' },
  'day.thu': { en: 'Thu', ar: 'الخميس' },
  'day.fri': { en: 'Fri', ar: 'الجمعة' },
  'day.sat': { en: 'Sat', ar: 'السبت' },
  'wb.eyebrow': { en: 'Find your table', ar: 'دوّر ربعك' },
  'wb.title': { en: 'The Wanted Board', ar: 'لوحة الطلبات' },
  'wb.sub': {
    en: 'Post a game you know and will teach, and gather players. Staff get in touch once a post fills to arrange the day and time.',
    ar: 'انشر لعبة تعرفها وبتعلّمها للربع، واجمع لاعبين. الموظفين بيتواصلون معاكم لما يكتمل العدد لتحديد اليوم والوقت.',
  },
  'wb.postOne': { en: 'Post a game', ar: 'انشر لعبة' },
  'wb.close': { en: 'Cancel', ar: 'إلغاء' },
  'wb.signInToPost': {
    en: 'Sign in to post a game or register interest.',
    ar: 'سجّل دخولك عشان تنشر لعبة أو تسجّل اهتمامك.',
  },
  'wb.mine': { en: 'My posts', ar: 'منشوراتي' },
  'wb.open': { en: 'Looking for players', ar: 'يدوّرون لاعبين' },
  'wb.empty': { en: 'Nothing on the board yet.', ar: 'ما في شي على اللوحة بعد.' },
  'wb.game': { en: 'Game', ar: 'اللعبة' },
  'wb.notInLibrary': { en: 'Not in our library…', ar: 'مو من مكتبتنا…' },
  'wb.gameName': { en: 'Game name', ar: 'اسم اللعبة' },
  'wb.needed': { en: 'Players needed', ar: 'اللاعبين المطلوبين' },
  'wb.min': { en: 'Min', ar: 'الأقل' },
  'wb.max': { en: 'Max', ar: 'الأكثر' },
  'wb.type': { en: 'Session type', ar: 'نوع الجلسة' },
  'wb.type.open': { en: 'Open to all', ar: 'للجميع' },
  'wb.type.males_only': { en: 'Males only', ar: 'شباب فقط' },
  'wb.type.females_only': { en: 'Females only', ar: 'بنات فقط' },
  'wb.days': { en: 'Preferred days', ar: 'الأيام المناسبة' },
  'wb.ack': {
    en: 'I know this game and I will lead and teach the session for anyone new to it.',
    ar: 'أعرف هاللعبة وألتزم إني أقود الجلسة وأعلّم أي أحد جديد عليها.',
  },
  'wb.ackRequired': {
    en: 'Please confirm you know the game and will lead the session.',
    ar: 'أكد إنك تعرف اللعبة وبتقود الجلسة.',
  },
  'wb.daysRequired': { en: 'Pick at least one day.', ar: 'اختر يوم واحد على الأقل.' },
  'wb.gameRequired': { en: 'Pick or name a game.', ar: 'اختر لعبة أو اكتب اسمها.' },
  'wb.rangeBad': {
    en: 'Maximum players cannot be lower than minimum.',
    ar: 'الحد الأعلى ما يصير أقل من الأدنى.',
  },
  'wb.reviewNote': {
    en: 'Your post goes to staff for a quick review before it appears on the board.',
    ar: 'منشورك يروح للموظفين لمراجعة سريعة قبل ما يظهر على اللوحة.',
  },
  'wb.pendingReview': {
    en: 'Posted — staff will review it shortly and it will appear on the board once approved.',
    ar: 'تم النشر — الموظفين بيراجعونه وبيظهر على اللوحة بعد الموافقة.',
  },
  'wb.submit': { en: 'Post to the board', ar: 'انشر على اللوحة' },
  'wb.posting': { en: 'Posting…', ar: 'جاري النشر…' },
  'wb.failed': { en: 'That did not work. Please try again.', ar: 'ما ضبطت. حاول مرة ثانية.' },
  'wb.players': { en: '{min}–{max} players', ar: '{min}–{max} لاعبين' },
  'wb.interested': { en: '{n} of {max} interested', ar: '{n} من {max} مهتمين' },
  'wb.join': { en: "I'm interested", ar: 'أنا مهتم' },
  'wb.youAreIn': { en: "You're interested", ar: 'سجّلت اهتمامك' },
  'wb.full': { en: 'Full', ar: 'مكتمل' },
  'wb.status.pending': { en: 'Awaiting review', ar: 'بانتظار المراجعة' },
  'wb.status.open': { en: 'Open', ar: 'مفتوح' },
  'wb.status.completed': { en: 'Completed', ar: 'مكتمل' },
  'wb.status.rejected': { en: 'Not approved', ar: 'غير موافق عليه' },
  'about.eyebrow': { en: 'Our story', ar: 'قصتنا' },
  'about.title': { en: 'About Cozy Den', ar: 'عن كوزي دن' },
  'about.sub': { en: 'Placeholder — final copy to follow.', ar: 'نص مؤقت — النص النهائي لاحقاً.' },
  'about.storyTitle': { en: 'How it started', ar: 'كيف بدينا' },
  'about.storyBody': {
    en: 'Placeholder. Cozy Den began as a simple idea: a room where people put their phones down and play something together. Final copy to be supplied.',
    ar: 'نص مؤقت. كوزي دن بدت بفكرة بسيطة: مكان يحطون فيه الناس تلفوناتهم ويلعبون سوا. النص النهائي لاحقاً.',
  },
  'about.conceptTitle': { en: 'The concept', ar: 'الفكرة' },
  'about.conceptBody': {
    en: 'Placeholder. Book a table for a two-hour session, pick anything off the shelf, and order from the counter. Final copy to be supplied.',
    ar: 'نص مؤقت. احجز طاولة لساعتين، اختر أي لعبة من الرف، واطلب من الكاونتر. النص النهائي لاحقاً.',
  },
  'about.pillar.games': { en: 'The games', ar: 'الألعاب' },
  'about.pillar.games.body': {
    en: 'Placeholder — over 100 titles, from quick party games to long strategy nights.',
    ar: 'نص مؤقت — أكثر من ١٠٠ لعبة، من الألعاب السريعة للسهرات الاستراتيجية.',
  },
  'about.pillar.food': { en: 'The food', ar: 'الأكل' },
  'about.pillar.food.body': {
    en: 'Placeholder — snacks and drinks built for long sessions.',
    ar: 'نص مؤقت — أكل ومشروبات تناسب الجلسات الطويلة.',
  },
  'about.pillar.people': { en: 'The people', ar: 'الناس' },
  'about.pillar.people.body': {
    en: 'Placeholder — regulars, first-timers, and everyone in between.',
    ar: 'نص مؤقت — زبائن دائمين، وأول مرة، وكل من بينهم.',
  },
  'about.visitTitle': { en: 'Come see us', ar: 'زورونا' },
  'about.visitBody': {
    en: 'Placeholder — open 2pm to 3am, last seating 1am.',
    ar: 'نص مؤقت — مفتوح من ٢ الظهر إلى ٣ الفجر، آخر جلسة ١.',
  },
  'staff.wanted': { en: 'Wanted Board', ar: 'لوحة الطلبات' },
  'staff.wbApprove': { en: 'Approve & publish', ar: 'وافق وانشر' },
  'staff.wbReject': { en: 'Reject', ar: 'ارفض' },
  'staff.wbInterested': { en: 'Interested members', ar: 'الأعضاء المهتمون' },
  'staff.wbNone': { en: 'No posts.', ar: 'ما في منشورات.' },
  'staff.wbPoster': { en: 'Posted by', ar: 'نشرها' },
  'staff.reviewed': { en: 'Reviewed', ar: 'تمت المراجعة' },
  'bk.peakWeekend': { en: 'Weekend rate', ar: 'سعر نهاية الأسبوع' },
  'team.role': { en: 'Role', ar: 'الصلاحية' },
  'team.admin': { en: 'Admin', ar: 'مشرف' },
  'team.staff': { en: 'Staff', ar: 'موظف' },
  'team.makeAdmin': { en: 'Make admin', ar: 'ترقية لمشرف' },
  'team.makeStaff': { en: 'Remove admin', ar: 'إزالة الإشراف' },
  'team.confirmAdmin': {
    en: 'Make {email} an admin? Admins can change prices and manage who has access.',
    ar: 'تبي تخلي {email} مشرف؟ المشرفين يقدرون يغيرون الأسعار ويديرون الصلاحيات.',
  },
  'team.confirmUnadmin': {
    en: 'Remove admin access from {email}? They stay a staff member.',
    ar: 'تبي تشيل الإشراف عن {email}؟ بيضل موظف عادي.',
  },
  'staff.games': { en: 'Game library', ar: 'مكتبة الألعاب' },
  'staff.menu': { en: 'Menu', ar: 'المنيو' },
  'cat.gamesHint': {
    en: 'Add, edit or remove games. A game that has been booked or logged as played is retired instead of deleted, so nobody loses their history.',
    ar: 'أضف أو عدّل أو احذف الألعاب. اللعبة اللي انحجزت أو انسجلت بالتاريخ تنسحب بدل ما تنحذف، عشان ما يضيع تاريخ أحد.',
  },
  'cat.menuHint': {
    en: 'Add, edit or remove food and drink. An item that appears on a past order is withdrawn instead of deleted, so old receipts stay correct.',
    ar: 'أضف أو عدّل أو احذف الأكل والشرب. الصنف اللي بطلب سابق ينسحب بدل ما ينحذف، عشان الفواتير القديمة تضل صحيحة.',
  },
  'cat.priceHint': {
    en: 'Set to 0 to keep the price off the website.',
    ar: 'حط ٠ إذا ما تبي السعر يظهر بالموقع.',
  },
  'cat.priceHidden': { en: 'Not shown', ar: 'غير معروض' },
  'cat.addGame': { en: 'Add a game', ar: 'أضف لعبة' },
  'cat.addItem': { en: 'Add an item', ar: 'أضف صنف' },
  'cat.title': { en: 'Title', ar: 'الاسم' },
  'cat.name': { en: 'Name', ar: 'الاسم' },
  'cat.category': { en: 'Category', ar: 'التصنيف' },
  'cat.players': { en: 'Players', ar: 'اللاعبين' },
  'cat.description': { en: 'Description', ar: 'الوصف' },
  'cat.purchaseUrl': { en: 'Where to buy (link)', ar: 'رابط الشراء' },
  'cat.shownToCustomers': { en: 'Shown to customers', ar: 'يظهر للزبائن' },
  'cat.visible': { en: 'Visible', ar: 'الظهور' },
  'cat.liveTag': { en: 'Live', ar: 'ظاهر' },
  'cat.retiredTag': { en: 'Retired', ar: 'مسحوب' },
  'cat.edit': { en: 'Edit', ar: 'تعديل' },
  'cat.remove': { en: 'Remove', ar: 'حذف' },
  'cat.save': { en: 'Save', ar: 'حفظ' },
  'cat.saving': { en: 'Saving…', ar: 'جاري الحفظ…' },
  'cat.cancel': { en: 'Cancel', ar: 'إلغاء' },
  'cat.noGames': { en: 'No games yet.', ar: 'ما في ألعاب بعد.' },
  'cat.noItems': { en: 'No menu items yet.', ar: 'ما في أصناف بعد.' },
  'cat.confirmRemove': { en: 'Remove {name}?', ar: 'تبي تحذف {name}؟' },
  'cat.deleted': { en: '{name} was deleted.', ar: 'تم حذف {name}.' },
  'cat.retired': {
    en: '{name} is attached to past records, so it was retired instead of deleted — hidden from customers, history intact.',
    ar: '{name} مرتبط بسجلات سابقة، فانسحب بدل ما ينحذف — مخفي عن الزبائن والتاريخ محفوظ.',
  },
  'staff.pricing': { en: 'Pricing', ar: 'الأسعار' },
  'pr.baseTitle': { en: 'Standard rates', ar: 'الأسعار الأساسية' },
  'pr.baseHelp': {
    en: 'Per booking, for the full two-hour session. Thursday, Friday and Saturday use the weekend rate.',
    ar: 'لكل حجز، للجلسة كاملة ساعتين. الخميس والجمعة والسبت بسعر نهاية الأسبوع.',
  },
  'pr.peak': { en: 'Weekend (KD)', ar: 'نهاية الأسبوع (د.ك)' },
  'pr.offPeak': { en: 'Other days (KD)', ar: 'باقي الأيام (د.ك)' },
  'pr.overrideTitle': { en: 'Special dates', ar: 'تواريخ خاصة' },
  'pr.overrideHelp': {
    en: 'Set a different price for one date — a holiday, a discount day, or an event. This wins over the standard rates.',
    ar: 'حدد سعر مختلف ليوم معيّن — عطلة، يوم خصم، أو فعالية. هذا السعر يغلب الأسعار الأساسية.',
  },
  'pr.date': { en: 'Date', ar: 'التاريخ' },
  'pr.label': { en: 'Reason', ar: 'السبب' },
  'pr.labelHint': { en: 'e.g. Eid al-Fitr', ar: 'مثال: عيد الفطر' },
  'pr.price': { en: 'Price (KD)', ar: 'السعر (د.ك)' },
  'pr.add': { en: 'Add date', ar: 'أضف تاريخ' },
  'pr.save': { en: 'Save', ar: 'حفظ' },
  'pr.saved': { en: 'Saved.', ar: 'تم الحفظ.' },
  'pr.failed': { en: 'Could not save.', ar: 'ما انحفظ.' },
  'pr.needDateLabel': { en: 'Pick a date and give a reason.', ar: 'اختر تاريخ واكتب السبب.' },
  'pr.upcoming': { en: 'Upcoming special dates', ar: 'التواريخ الخاصة القادمة' },
  'pr.none': { en: 'No special dates set.', ar: 'ما في تواريخ خاصة.' },
  'pr.remove': { en: 'Remove', ar: 'حذف' },
  'acct.verifyFirst': {
    en: 'Confirm your email address to see your bookings. Check your inbox for the link we sent you.',
    ar: 'أكد إيميلك عشان تشوف حجوزاتك. شيّك على الرابط اللي أرسلناه لك.',
  },

  // ---- recurrent customers (staff) ----
  'staff.customers': { en: 'Customers', ar: 'العملاء' },
  'cust.hint': {
    en: 'Recurrent guests — a contact list for events & offers.',
    ar: 'العملاء المتكررين — قائمة تواصل للفعاليات والعروض.',
  },
  'cust.visits': { en: 'Visits', ar: 'الزيارات' },
  'cust.spent': { en: 'Total spent', ar: 'إجمالي الصرف' },
  'cust.last': { en: 'Last visit', ar: 'آخر زيارة' },
  'cust.empty': { en: 'No customers yet.', ar: 'ما في عملاء بعد.' },

  // ---- events / calendar ----
  'nav.events': { en: 'Our Calendar', ar: 'فعالياتنا' },
  'ev.eyebrow': { en: "What's on", ar: 'شنو صاير' },
  'ev.title': { en: 'Our Calendar', ar: 'تقويمنا' },
  'ev.sub': {
    en: 'Everything coming up — nights at the Den and places you can find us.',
    ar: 'كل اللي جاي — ليالينا بالدن والأماكن اللي تلقونا فيها.',
  },
  'ev.upcoming': { en: 'Upcoming events', ar: 'فعاليات قادمة' },
  'ev.seeAll': { en: 'Full calendar →', ar: 'التقويم الكامل ←' },
  'ev.internal': { en: 'At Cozy Den', ar: 'في كوزي دن' },
  'ev.external': { en: 'Off-site', ar: 'خارج المحل' },
  'ev.none': { en: 'No upcoming events right now — check back soon.', ar: 'ما في فعاليات حالياً — ترقبونا.' },
  'ev.all': { en: 'All', ar: 'الكل' },
  'ev.past': { en: 'Past', ar: 'سابقة' },

  // ---- game library ----
  'gl.buy': { en: 'Buy on Board Games Panda', ar: 'اشترها من بورد جيمز باندا' },
  'gl.storeTitle': { en: 'Loved a game? Take it home.', ar: 'عجبتك لعبة؟ خذها بيتك.' },
  'gl.storeSub': {
    en: 'Shop the same titles at Board Games Q8 — delivered across Kuwait.',
    ar: 'اشتر نفس الألعاب من بورد جيمز كويت — توصيل داخل الكويت.',
  },
  'gl.storeCta': { en: 'Visit store →', ar: 'زور المتجر ←' },
  'gl.players': { en: 'players', ar: 'لاعبين' },

  // ---- game history ----
  'gh.title': { en: "Games I've Played", ar: 'الألعاب اللي لعبتها' },
  'gh.sub': { en: 'Log what you played after a visit.', ar: 'سجّل اللي لعبته بعد زيارتك.' },
  'gh.empty': { en: "You haven't logged any games yet.", ar: 'ما سجلت أي لعبة بعد.' },
  'gh.add': { en: 'Log a game', ar: 'سجّل لعبة' },
  'gh.pick': { en: 'Pick a game', ar: 'اختر لعبة' },
  'gh.date': { en: 'Played on', ar: 'تاريخ اللعب' },
  'gh.save': { en: 'Add to history', ar: 'أضف للسجل' },
  'gh.remove': { en: 'Remove', ar: 'حذف' },
  'gh.already': { en: 'Already logged for that date.', ar: 'مسجلة بهذا التاريخ.' },
  'gh.signin': { en: 'Create an account to track the games you play.', ar: 'سوِّ حساب عشان تتابع الألعاب اللي تلعبها.' },

  // ---- staff: events + promo ----
  'staff.events': { en: 'Events', ar: 'الفعاليات' },
  'staff.promo': { en: 'Promo popup', ar: 'إعلان الترحيب' },
  'staff.team': { en: 'Team', ar: 'الفريق' },
  'staff.support': { en: 'Support', ar: 'الدعم' },
  'nav.support': { en: 'Support', ar: 'الدعم' },
  'sup.eyebrow': { en: 'We are listening', ar: 'إحنا نسمعك' },
  'sup.title': { en: 'Suggestions & Support', ar: 'اقتراحات ودعم' },
  'sup.sub': {
    en: 'Tell us what would make Cozy Den better, or let us know if something went wrong. We reply on the same thread.',
    ar: 'قل لنا شنو يخلي كوزي دن أحسن، أو خبرنا إذا صار شي غلط. نرد عليك بنفس المحادثة.',
  },
  'sup.newTitle': { en: 'Start a new request', ar: 'ابدأ طلب جديد' },
  'sup.kind.suggestion': { en: 'Suggestion', ar: 'اقتراح' },
  'sup.kind.complaint': { en: 'Complaint', ar: 'شكوى' },
  'sup.kind.question': { en: 'Question', ar: 'سؤال' },
  'sup.severity': { en: 'How urgent is it?', ar: 'شقد مستعجل؟' },
  'sup.sev.low': { en: 'Low', ar: 'بسيط' },
  'sup.sev.normal': { en: 'Normal', ar: 'عادي' },
  'sup.sev.urgent': { en: 'Urgent', ar: 'مستعجل' },
  'sup.subject': { en: 'Subject', ar: 'الموضوع' },
  'sup.subjectPh': { en: 'A short summary', ar: 'ملخص قصير' },
  'sup.message': { en: 'Message', ar: 'الرسالة' },
  'sup.messagePh': { en: 'Tell us what happened…', ar: 'خبرنا شنو صار…' },
  'sup.send': { en: 'Send', ar: 'أرسل' },
  'sup.mine': { en: 'Your requests', ar: 'طلباتك' },
  'sup.none': { en: 'Nothing here yet.', ar: 'ما في شي بعد.' },
  'sup.back': { en: 'All requests', ar: 'كل الطلبات' },
  'sup.reply': { en: 'Reply', ar: 'رد' },
  'sup.internal': { en: 'Internal', ar: 'داخلي' },
  'sup.internalNote': { en: 'Staff-only internal note', ar: 'ملاحظة داخلية للموظفين فقط' },
  'sup.saveNote': { en: 'Save note', ar: 'احفظ الملاحظة' },
  'sup.closedNote': {
    en: 'This request is closed. Start a new one if you need anything else.',
    ar: 'هذا الطلب مسكّر. ابدأ طلب جديد إذا تحتاج شي ثاني.',
  },
  'sup.status.open': { en: 'Open', ar: 'مفتوح' },
  'sup.status.in_progress': { en: 'In progress', ar: 'قيد المعالجة' },
  'sup.status.resolved': { en: 'Resolved', ar: 'تم الحل' },
  'sup.status.closed': { en: 'Closed', ar: 'مسكّر' },
  'sup.type': { en: 'Type', ar: 'النوع' },
  'sup.updated': { en: 'Updated', ar: 'آخر تحديث' },
  'sup.open': { en: 'Open', ar: 'افتح' },
  'sup.history': { en: 'Status history', ar: 'سجل الحالات' },
  'team.hint': {
    en: 'Staff access is granted here. The person must register a customer account first — then enter their email below to promote them.',
    ar: 'صلاحية الموظفين تُعطى من هنا. لازم الشخص يسجّل حساب عادي أول، وبعدين اكتب إيميله تحت عشان تعطيه الصلاحية.',
  },
  'team.email': { en: 'Email of a registered account', ar: 'إيميل حساب مسجّل' },
  'team.grant': { en: 'Grant staff access', ar: 'أعطِ الصلاحية' },
  'team.revoke': { en: 'Revoke', ar: 'سحب الصلاحية' },
  'team.since': { en: 'Member since', ar: 'عضو منذ' },
  'team.you': { en: 'You', ar: 'أنت' },
  'team.confirmRevoke': {
    en: 'Revoke staff access for {email}? They keep their customer account.',
    ar: 'تسحب صلاحية الموظف من {email}؟ حسابه العادي بيظل موجود.',
  },
  'staff.newEvent': { en: '+ New event', ar: '+ فعالية جديدة' },
  'staff.evTitle': { en: 'Title', ar: 'العنوان' },
  'staff.evDesc': { en: 'Description', ar: 'الوصف' },
  'staff.evLocation': { en: 'Location', ar: 'المكان' },
  'staff.evType': { en: 'Type', ar: 'النوع' },
  'staff.evImage': { en: 'Image URL', ar: 'رابط الصورة' },
  'staff.evFeatured': { en: 'Featured on homepage', ar: 'مميّزة بالصفحة الرئيسية' },
  'staff.save': { en: 'Save', ar: 'حفظ' },
  'staff.cancel': { en: 'Cancel', ar: 'إلغاء' },
  'staff.edit': { en: 'Edit', ar: 'تعديل' },
  'staff.delete': { en: 'Delete', ar: 'حذف' },
  'staff.confirmDelete': { en: 'Delete this event?', ar: 'تحذف هالفعالية؟' },
  'staff.promoText': { en: 'Popup text', ar: 'نص الإعلان' },
  'staff.promoLink': { en: 'Link URL', ar: 'رابط' },
  'staff.promoLabel': { en: 'Button label', ar: 'نص الزر' },
  'staff.promoActive': { en: 'Show popup to visitors', ar: 'اعرض الإعلان للزوار' },
  'staff.promoHint': {
    en: 'Shown once per visitor session. Leave inactive to hide it.',
    ar: 'يظهر مرة وحدة بكل زيارة. عطّله عشان يختفي.',
  },
  'promo.close': { en: 'Close', ar: 'إغلاق' },
  'verify.prompt': {
    en: 'Please confirm your email ({email}) — we sent you a link.',
    ar: 'رجاءً أكّد إيميلك ({email}) — رسّلنا لك رابط.',
  },
  'verify.resend': { en: 'Resend link', ar: 'أعد إرسال الرابط' },
  'verify.sending': { en: 'Sending…', ar: 'جاري الإرسال…' },
  'verify.sent': { en: 'Sent — check your inbox.', ar: 'انرسل — شيّك إيميلك.' },
  'verify.okTitle': { en: 'Email confirmed', ar: 'تم تأكيد الإيميل' },
  'verify.okBody': {
    en: 'Thanks — your email is verified. Enjoy Cozy Den!',
    ar: 'شكرًا — تم تأكيد إيميلك. استمتع في كوزي دن!',
  },
  'verify.badTitle': { en: 'Link expired or invalid', ar: 'الرابط منتهي أو غير صالح' },
  'verify.badBody': {
    en: 'This link didn’t work. Sign in and use “Resend link” to get a fresh one.',
    ar: 'الرابط ما اشتغل. سجّل دخول واستخدم «أعد إرسال الرابط» عشان تجيب واحد جديد.',
  },
  'verify.home': { en: 'Go home', ar: 'الرئيسية' },
  'promo.kicker': { en: 'Upcoming Event', ar: 'فعالية قادمة' },

  // ---- booking status workflow + staff manual entry ----
  'status.all': { en: 'All', ar: 'الكل' },
  'status.pending': { en: 'Pending', ar: 'بالانتظار' },
  'status.pending_payment': { en: 'Pending payment', ar: 'بانتظار الدفع' },
  'status.print_receipt': { en: 'Print receipt', ar: 'اطبع الإيصال' },
  'status.order_complete': { en: 'Order complete', ar: 'الطلب مكتمل' },
  'status.cancelled': { en: 'Cancelled', ar: 'ملغي' },
  'source.online': { en: 'Online', ar: 'أونلاين' },
  'source.staff_manual': { en: 'Staff', ar: 'يدوي' },
  'staff.newBooking': { en: '+ New booking', ar: '+ حجز جديد' },
  'staff.closeForm': { en: 'Close form', ar: 'إغلاق النموذج' },
  'staff.confirmPh': { en: 'Enter code to confirm arrival', ar: 'اكتب الكود لتأكيد الحضور' },
  'staff.confirmBtn': { en: 'Confirm', ar: 'تأكيد' },
  'staff.printedBtn': { en: 'Print receipt', ar: 'اطبع الإيصال' },
  'receipt.title': { en: 'Booking Receipt', ar: 'إيصال الحجز' },
  'receipt.code': { en: 'Code', ar: 'الرمز' },
  'receipt.guest': { en: 'Guest', ar: 'الضيف' },
  'receipt.contact': { en: 'Contact', ar: 'التواصل' },
  'receipt.table': { en: 'Table', ar: 'الطاولة' },
  'receipt.date': { en: 'Date', ar: 'التاريخ' },
  'receipt.time': { en: 'Time', ar: 'الوقت' },
  'receipt.fee': { en: 'Table holding fee', ar: 'رسوم حجز الطاولة' },
  'receipt.total': { en: 'Total', ar: 'الإجمالي' },
  'receipt.thanks': { en: 'Thank you — enjoy your session!', ar: 'شكرًا لكم — استمتعوا بوقتكم!' },
  'staff.contact': { en: 'Contact', ar: 'التواصل' },
  'staff.contactPh': { en: 'Phone or email', ar: 'تلفون أو إيميل' },
  'staff.source': { en: 'Source', ar: 'المصدر' },
  'staff.start': { en: 'Start time', ar: 'وقت البداية' },
  'staff.createBtn': { en: 'Create booking', ar: 'إنشاء الحجز' },
};

function readInitial(): Lang {
  try {
    const v = localStorage.getItem('cd_lang');
    if (v === 'ar' || v === 'en') return v;
  } catch {
    /* localStorage may be unavailable */
  }
  return 'en';
}

interface Ctx {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Vars) => string;
  money: (cents: number) => string;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readInitial);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem('cd_lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang, dir]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir,
      setLang,
      toggle: () => setLang((l) => (l === 'en' ? 'ar' : 'en')),
      t: (key, vars) => {
        const entry = dict[key];
        let s = entry ? entry[lang] : key;
        if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
        return s;
      },
      // Currency: "KD 3.80" in English, "٣.٨٠ د.ك" style (Western digits) in Arabic.
      money: (cents: number) => {
        const n = (cents / 100).toFixed(2);
        return lang === 'ar' ? `${n} د.ك` : `KD ${n}`;
      },
    }),
    [lang, dir]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
