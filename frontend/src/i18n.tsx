import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'ar';
type Vars = Record<string, string | number>;

// EN = plain English. AR = Arabic with a light Kuwaiti dialect flavour.
const dict: Record<string, { en: string; ar: string }> = {
  // ---- nav / footer ----
  'nav.home': { en: 'Home', ar: 'الرئيسية' },
  'nav.games': { en: 'Games', ar: 'الألعاب' },
  'nav.menu': { en: 'Menu', ar: 'المنيو' },
  'nav.staff': { en: 'Staff', ar: 'الموظفين' },
  'nav.login': { en: 'Log in', ar: 'تسجيل دخول' },
  'nav.logout': { en: 'Log out', ar: 'تسجيل خروج' },
  'footer.tagline': {
    en: 'Board games, great food, and good company — nightly.',
    ar: 'ألعاب، وأكل زين، وونس حلو — كل ليلة.',
  },
  'footer.visit': { en: 'Visit', ar: 'زورونا' },
  'footer.book': { en: 'Book a table', ar: 'احجز طاولة' },
  'footer.library': { en: 'Game library', ar: 'مكتبة الألعاب' },
  'footer.food': { en: 'Food & drink', ar: 'أكل وشرب' },
  'footer.cafe': { en: 'Café', ar: 'الكافيه' },
  'footer.rules': { en: 'House rules', ar: 'قوانين المحل' },
  'footer.location': { en: 'Location', ar: 'الموقع' },
  'footer.contact': { en: 'Contact', ar: 'تواصل معنا' },
  'footer.dashboard': { en: 'Dashboard', ar: 'لوحة التحكم' },
  'footer.instagram': { en: 'Cozy Den on Instagram', ar: 'كوزي دن على إنستقرام' },
  'footer.legal': {
    en: '© 2026 Cozy Den Board Game Café · Prototype — payments & email are stubbed.',
    ar: '© 2026 كوزي دن · نسخة تجريبية — الدفع والإيميل تجريبي.',
  },

  // ---- home ----
  'home.eyebrow': { en: 'The ultimate midnight social hub', ar: 'وجهتك الليلية الأولى' },
  'home.title.a': { en: 'Where every', ar: 'كل' },
  'home.title.move': { en: 'move', ar: 'نقلة' },
  'home.title.b': { en: 'matters, and every', ar: 'تفرق، وكل' },
  'home.title.game': { en: 'game', ar: 'لعبة' },
  'home.title.c': { en: 'tells a story.', ar: 'لها قصة.' },
  'home.sub': {
    en: 'Book a 2-hour table session online, then pick from 100+ tabletop games and order great food when you arrive. Your den, your rules.',
    ar: 'احجز جلسة ساعتين أونلاين، وعقب اختر من +100 لعبة واطلب أكل لذيذ لين توصل. مكانك، وقوانينك.',
  },
  'home.claim': { en: 'Claim Your Table', ar: 'احجز طاولتك' },
  'home.explore': { en: 'Explore Games', ar: 'تصفّح الألعاب' },
  'home.stat.games': { en: 'Games on shelf', ar: 'لعبة على الرف' },
  'home.stat.tables': { en: 'Cozy tables', ar: 'طاولات مريحة' },
  'home.stat.hours': { en: 'Till 10pm', ar: 'لين ١٠ المسا' },
  'home.stat.hoursSub': { en: 'Last seating', ar: 'آخر حجز' },
  'home.how': { en: 'How it works', ar: 'كيف يمشي الحال' },
  'home.howSub': { en: 'Four steps from craving to checkmate.', ar: 'أربع خطوات من الجوع للفوز.' },
  'home.step1': { en: 'Pick a table', ar: 'اختر طاولة' },
  'home.step1b': {
    en: 'Pick a date and any 30-minute start time for a 2-hour session.',
    ar: 'اختر التاريخ وأي وقت بداية كل نص ساعة لجلسة ساعتين.',
  },
  'home.step2': { en: 'Pay the holding fee', ar: 'ادفع رسوم الحجز' },
  'home.step2b': {
    en: 'A small table-holding fee secures your session.',
    ar: 'رسوم بسيطة تثبّت حجزك.',
  },
  'home.step3': { en: 'Show your code', ar: 'وريهم كودك' },
  'home.step3b': {
    en: 'Flash your booking code at the counter when you arrive.',
    ar: 'وري كود الحجز عند الكاونتر لين توصل.',
  },
  'home.step4': { en: 'Play & order there', ar: 'العب واطلب هناك' },
  'home.step4b': {
    en: 'Pick any game from the shelf and order from the counter.',
    ar: 'اختر أي لعبة من الرف واطلب من الكاونتر.',
  },
  'home.popular': { en: 'Popular games', ar: 'ألعاب مشهورة' },
  'home.seeAll': { en: 'See all →', ar: 'شوف الكل ←' },
  'home.onMenu': { en: 'On the menu', ar: 'من المنيو' },
  'home.fullMenu': { en: 'Full menu →', ar: 'المنيو الكامل ←' },
  'home.ctaTitle': { en: 'Your table is waiting.', ar: 'طاولتك تنتظرك.' },
  'home.ctaSub': {
    en: "Grab a seating before they're gone tonight.",
    ar: 'احجز قبل لا تخلص الطاولات الليلة.',
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
    en: 'Every booking is a 2-hour session; start times roll every 30 minutes.',
    ar: 'كل حجز جلسة ساعتين، وأوقات البداية كل نص ساعة.',
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
  'bk.payToken': { en: 'Payment token (mock)', ar: 'رمز الدفع (تجريبي)' },
  'bk.payHint': {
    en: 'Payment is stubbed. Use tok_demo to approve, or tok_decline to simulate a declined card.',
    ar: 'الدفع تجريبي. استخدم tok_demo للقبول، أو tok_decline لتجربة بطاقة مرفوضة.',
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
  'staff.creds': {
    en: 'Dev credentials: staff@cozyden.local / cozyden123',
    ar: 'بيانات تجريبية: staff@cozyden.local / cozyden123',
  },
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
  'auth.stat1v': { en: '5 tables', ar: '٥ طاولات' },
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
  'nav.register': { en: 'Register', ar: 'تسجيل' },
  'nav.mybookings': { en: 'My Bookings', ar: 'حجوزاتي' },
  'acct.title': { en: 'My Bookings', ar: 'حجوزاتي' },
  'acct.sub': { en: 'Your past and upcoming sessions.', ar: 'جلساتك السابقة والقادمة.' },
  'acct.empty': { en: "You haven't booked anything yet.", ar: 'ما حجزت شي بعد.' },

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
  'nav.events': { en: 'Our Calendar', ar: 'تقويمنا' },
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
