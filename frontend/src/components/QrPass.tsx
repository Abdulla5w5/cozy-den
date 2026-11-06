import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/**
 * A QR check-in pass (migration 050). The code is only a link to
 * /c/<key> on this site; staff scan it with the phone's camera app. It is drawn
 * here in the browser, so no outside QR service ever sees the link, and the
 * library is loaded only when a pass is actually shown.
 *
 * "Save QR" downloads a small card — the code plus what it is for — so it is
 * easy to find in the phone's photos at the counter.
 */
export function passUrl(token: string): string {
  return `${window.location.origin}/c/${token}`;
}

export function QrPass({ token, lines }: { token: string; lines: string[] }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const url = passUrl(token);

  useEffect(() => {
    let active = true;
    import('qrcode')
      .then((QR) =>
        QR.toDataURL(url, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 480,
          color: { dark: '#17120d', light: '#ffffff' },
        }),
      )
      .then((data) => active && setSrc(data))
      .catch(() => active && setSrc(null));
    return () => {
      active = false;
    };
  }, [url]);

  async function save() {
    if (!src) return;
    // A card: brand line, the code, then what the pass is for.
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => undefined);
    const W = 600;
    const H = 760 + lines.length * 34;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.fillStyle = '#fffaf1';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#17120d';
    c.lineWidth = 6;
    c.strokeRect(3, 3, W - 6, H - 6);
    c.fillStyle = '#f47700';
    c.font = 'bold 40px sans-serif';
    c.textAlign = 'center';
    c.fillText('Cozy Den', W / 2, 70);
    c.fillStyle = '#17120d';
    c.font = '24px sans-serif';
    c.fillText(t('qr.cardTitle'), W / 2, 108);
    c.drawImage(img, 60, 140, 480, 480);
    c.font = 'bold 26px sans-serif';
    lines.forEach((line, i) => c.fillText(line, W / 2, 670 + i * 34));
    c.font = '20px sans-serif';
    c.fillStyle = '#5c5246';
    c.fillText(t('qr.cardHint'), W / 2, 690 + lines.length * 34);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'cozy-den-pass.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="qr-pass">
      <div className="qr-pass-code">
        {src ? <img src={src} alt={t('qr.alt')} width={220} height={220} /> : <span className="qr-pass-wait" />}
      </div>
      <div className="qr-pass-text">
        <strong>{t('qr.title')}</strong>
        <p>{t('qr.hint')}</p>
        <button type="button" className="cta button" onClick={save} disabled={!src}>
          {t('qr.save')}
        </button>
      </div>
    </div>
  );
}
