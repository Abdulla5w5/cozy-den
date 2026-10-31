import { useI18n } from '../i18n';

// A game-board roadmap: a tiled track winds from Start to the finish tag, and
// each of the four steps is a die on it showing the step's number in pips.
// Shared by the landing page's "How it works" and the Wanted Board's guide.

// The track in a 1000 x 170 box, stretched to the board's width: it enters on
// the left, passes through the four dice (alternately high and low, at the
// centres of four equal columns) and leaves on the right.
const ROADMAP_PATH =
  'M -20 85 C 40 85, 70 48, 125 48 S 300 122, 375 122 S 550 48, 625 48 S 800 122, 875 122 S 980 85, 1020 85';

// Pip positions on a 3 x 3 grid, cells numbered 1-9 left to right, top down.
const PIPS: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9] };

// One colour per stop along the roadmap, from the brand palette.
const STOP_COLORS = ['orange', 'blue', 'green', 'red'];

function Die({ value }: { value: number }) {
  return (
    <span className="roadmap-die" role="img" aria-label={String(value)}>
      {Array.from({ length: 9 }, (_, cell) => (
        <i key={cell} className={PIPS[value].includes(cell + 1) ? 'on' : ''} />
      ))}
    </span>
  );
}

/** `steps` are [title, body] i18n keys, four of them. */
export function Roadmap({ steps, className = '' }: { steps: string[][]; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`roadmap ${className}`.trim()}>
      <svg className="roadmap-track" viewBox="0 0 1000 170" preserveAspectRatio="none" aria-hidden="true">
        <path className="roadmap-track-edge" d={ROADMAP_PATH} />
        <path className="roadmap-track-fill" d={ROADMAP_PATH} />
        <path className="roadmap-track-tiles" d={ROADMAP_PATH} />
      </svg>
      <span className="roadmap-start" aria-hidden="true">{t('home.start')}</span>
      <ol className="roadmap-stops">
        {steps.map(([title, body], i) => (
          <li className={`roadmap-stop stop-${STOP_COLORS[i]}`} key={title}>
            <Die value={i + 1} />
            <div className="roadmap-card">
              <h3>{t(title)}</h3>
              <p className="muted">{t(body)}</p>
            </div>
          </li>
        ))}
      </ol>
      <span className="roadmap-finish" aria-hidden="true">{t('home.finish')}</span>
    </div>
  );
}
