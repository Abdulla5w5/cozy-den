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
    en: "Book a table, pick from 100+ tabletop games, and pre-order food & drink so it's waiting when you arrive. Your den, your rules.",
    ar: 'احجز طاولتك، واختر من +100 لعبة، واطلب أكلك وشربك يكون جاهز لين توصل. مكانك، وقوانينك.',
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
    en: 'Choose a date and a 2-hour seating that fits your crew.',
    ar: 'اختر التاريخ وفترة ساعتين تناسب جمعتكم.',
  },
  'home.step2': { en: 'Choose a game', ar: 'اختر لعبة' },
  'home.step2b': {
    en: 'From quick party games to deep strategy epics.',
    ar: 'من ألعاب السهرة السريعة لألعاب الاستراتيجية الثقيلة.',
  },
  'home.step3': { en: 'Order ahead', ar: 'اطلب من بدري' },
  'home.step3b': {
    en: 'Snacks and drinks, prepped for when you sit down.',
    ar: 'مقرمشات ومشروبات، جاهزة لين تجلس.',
  },
  'home.step4': { en: 'Show your code', ar: 'وريهم كودك' },
  'home.step4b': {
    en: 'Pay online and flash your code at the counter.',
    ar: 'ادفع أونلاين ووري كودك عند الكاونتر.',
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
    en: 'Add these to your booking at checkout.',
    ar: 'أضفها لحجزك عند الدفع.',
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
