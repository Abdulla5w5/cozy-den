import { useI18n } from '../i18n';

// The café's terms and conditions, as the café wrote them (supplied as two
// images, English and Arabic, Oct 2026). Kept here rather than in i18n because
// it is one long document per language, not interface strings. The booking
// form shows the same text in a pop-up (TermsBody) and will not take payment
// until the customer agrees.

interface TermsSection {
  title: string;
  /** A section is either one paragraph or a list of titled points. */
  body?: string;
  points?: { title: string; body: string }[];
}

const TERMS: Record<'en' | 'ar', { title: string; sections: TermsSection[]; closing: string }> = {
  en: {
    title: 'Terms and Conditions',
    sections: [
      {
        title: 'Booking confirmation',
        body: 'All bookings are confirmed once payment is processed.',
      },
      {
        title: 'Rescheduling policy',
        points: [
          {
            title: 'Notice period',
            body: 'Customers are allowed to reschedule their booking up to one hour before their scheduled time. Any rescheduling done under one hour before the scheduled time will not be accepted.',
          },
          {
            title: 'Rescheduling limit',
            body: 'Each booking may be rescheduled only once. Customers can reschedule their booking to another time on the same day, or to a different day, only if there are available slots. Further rescheduling is not allowed and the booking will be considered cancelled.',
          },
        ],
      },
      {
        title: 'Cancellation policy and refunds',
        points: [
          {
            title: 'Cancellations made more than 2 hours before',
            body: 'Cancellations made two hours before the booking time will receive a full refund.',
          },
          {
            title: 'Cancellations made within 2 hours',
            body: 'Any cancellation made within two hours of the booking time will receive 50% refund of the paid amount.',
          },
          {
            title: 'No-show',
            body: 'If one hour passes on the booking time and no one shows up, the booking will be considered canceled, and no refunds will be provided.',
          },
        ],
      },
      {
        title: 'Food and beverages',
        body: 'Any outside food and beverages are not allowed in our café. Want to take a look at our menu? Let us know and we will send you a link to view it!',
      },
    ],
    closing:
      'By completing payment through the provided booking link, you agree to our terms and conditions.',
  },
  ar: {
    title: 'الشروط والأحكام',
    sections: [
      {
        title: 'تأكيد الحجوزات',
        body: 'يتم تأكيد جميع الحجوزات بمجرد الدفع.',
      },
      {
        title: 'إعادة الجدولة',
        points: [
          {
            title: 'فترة الإشعار',
            body: 'يسمح للعملاء بتأجيل الحجز حتى ساعة واحدة قبل موعد الحجز المحدد. أي تأجيل يتم قبل أقل من ساعة من الموعد المحدد لن يُقبل.',
          },
          {
            title: 'حد إعادة الجدولة',
            body: 'يمكن تأجيل كل حجز مرة واحدة فقط إلى وقت آخر في نفس اليوم أو إلى يوم آخر فقط إذا كانت هناك أماكن شاغرة. لا يسمح بإعادة الجدولة مرة أخرى، وسيعتبر الحجز ملغى.',
          },
        ],
      },
      {
        title: 'الإلغاء والاسترداد',
        points: [
          {
            title: 'الإلغاء الذي يتم قبل أكثر من ساعتين من موعد الحجز',
            body: 'الإلغاء الذي يتم قبل ساعتين من وقت الحجز سيحصل على استرداد كامل للمبلغ المدفوع.',
          },
          {
            title: 'الإلغاء خلال ساعتين من موعد الحجز',
            body: 'أي إلغاء يتم خلال ساعتين من وقت الحجز سيحصل على استرداد بنسبة ٥٠٪ من المبلغ المدفوع.',
          },
          {
            title: 'عدم الحضور',
            body: 'إذا مرت ساعة واحدة على وقت الحجز ولم يحضر أحد، سيعتبر الحجز ملغي ولن يتم استرداد أي مبلغ.',
          },
        ],
      },
      {
        title: 'الأطعمة والمشروبات',
        body: 'لا يسمح بإحضار أي أطعمة أو مشروبات من خارج المقهى. هل ترغب بإلقاء نظرة على قائمتنا للمأكولات والمشروبات؟ أخبرنا وسنرسل لك رابطاً للاطلاع عليها!',
      },
    ],
    closing: 'باستكمال الدفع من خلال رابط الحجز، فإنكم توافقون على الشروط والأحكام.',
  },
};

export function termsTitle(lang: string) {
  return TERMS[lang === 'ar' ? 'ar' : 'en'].title;
}

/** The terms themselves, for the page and the booking form's pop-up. */
export function TermsBody() {
  const { lang } = useI18n();
  const doc = TERMS[lang === 'ar' ? 'ar' : 'en'];
  return (
    <>
      {doc.sections.map((s) => (
        <section key={s.title} className="terms-section">
          <h2>{s.title}</h2>
          {s.body && <p>{s.body}</p>}
          {s.points && (
            <ul>
              {s.points.map((p) => (
                <li key={p.title}>
                  <strong>{p.title}</strong>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="terms-closing">{doc.closing}</p>
    </>
  );
}

export function TermsPage() {
  const { lang } = useI18n();
  return (
    <div className="terms-page">
      <header className="page-header left">
        <span className="eyebrow">Cozy Den</span>
        <h1>{termsTitle(lang)}</h1>
      </header>
      <div className="card terms-card">
        <TermsBody />
      </div>
    </div>
  );
}
