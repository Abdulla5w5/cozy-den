import { type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../i18n';

// The café drawn as a room, with one button per table. Shared by the customer
// booking form and the staff day view: both show the same floor, they just
// colour the tables differently (free times vs. who is sitting there), so the
// per-table look is handed in by the caller through `decorate`.

// square: a small four-top. wide: a long rectangle. hex: the six-sided table.
// round: a circle. hall: the long room-filling table behind the D&D door.
// corner: the PlayStation corner, drawn as armchairs and a TV, not a table top.
type FloorShape = 'square' | 'round' | 'wide' | 'hex' | 'hall' | 'corner';

interface FloorPlacement {
  x: number;
  y: number;
  shape: FloorShape;
  /** The table top's colour. Shape and colour are set per table, not tied. */
  color: string;
  angle?: number;
  /** A photograph of this table, shown when a customer picks it to book. */
  photo?: string;
}

const GREEN = '#2d8b57';
const RED = '#e03a1f';
const BLUE = '#1177ee';
const BROWN = '#a86a34';
const BLACK = '#3a3a3a';
const ORANGE = '#f47700';

// These coordinates describe the physical cafe sketch, not booking data. The
// API remains the source of truth for which tables exist and which slots are
// free; an unknown future table still receives a sensible fallback position.
// Keyed by the table's current name, so a rename in the database must be
// mirrored here for the table to stay where it physically is.
const FLOOR_PLACEMENTS: Record<string, FloorPlacement> = {
  // The two green squares are the same kind of table and share one photograph.
  'Small Table 1': { x: 79, y: 58, shape: 'square', color: GREEN, angle: 1, photo: '/tables/green-square.webp' },
  'Small Table 2': { x: 52, y: 39, shape: 'square', color: GREEN, angle: 0, photo: '/tables/green-square.webp' },
  'Small Table 3': { x: 65, y: 18, shape: 'square', color: RED, angle: -1, photo: '/tables/red-square.webp' },
  'Big Table 1': { x: 72, y: 82, shape: 'wide', color: GREEN, angle: 0, photo: '/tables/green-rectangle.webp' },
  'Big Table 2': { x: 53, y: 65, shape: 'hex', color: BLUE, angle: 0, photo: '/tables/blue-hexagon.webp' },
  'Big Table 3': { x: 38, y: 18, shape: 'wide', color: RED, angle: 0, photo: '/tables/red-rectangle.webp' },
  'Big Table 4 (D&D)': { x: 20, y: 80, shape: 'hall', color: BLACK, angle: 0, photo: '/tables/dnd-table.webp' },
  'Floor Table': { x: 85, y: 19, shape: 'round', color: BROWN, angle: 0, photo: '/tables/floor-table.webp' },
  'PlayStation Corner': { x: 92, y: 43, shape: 'corner', color: ORANGE, angle: 0, photo: '/tables/playstation-corner.webp' },
};

const CORNER_LABEL = 'PlayStation Corner';

/** The photograph of a table, or null for one that has none (a new table, or a
 *  renamed one not yet added above — the panel then simply shows no picture). */
export function tablePhoto(label: string): string | null {
  return FLOOR_PLACEMENTS[label]?.photo ?? null;
}

const FALLBACK_PLACEMENTS: FloorPlacement[] = [
  { x: 16, y: 20, shape: 'square', color: GREEN },
  { x: 40, y: 20, shape: 'square', color: GREEN },
  { x: 68, y: 20, shape: 'square', color: GREEN },
  { x: 20, y: 58, shape: 'wide', color: GREEN },
  { x: 50, y: 47, shape: 'round', color: BROWN },
  { x: 75, y: 62, shape: 'wide', color: GREEN },
  { x: 45, y: 78, shape: 'hex', color: BLUE },
  { x: 84, y: 42, shape: 'round', color: BROWN },
];

function floorPlacement(label: string, index: number) {
  return FLOOR_PLACEMENTS[label] ?? FALLBACK_PLACEMENTS[index % FALLBACK_PLACEMENTS.length];
}

export function mapTableName(label: string) {
  if (label.includes('(D&D)')) return 'D&D';
  return label
    .replace('Small Table ', 'S')
    .replace('Big Table ', 'B')
    .replace('Floor Table', 'Floor');
}

interface ChairPosition {
  x: number;
  y: number;
  angle: number;
}

function chairPositions(shape: FloorShape, count: number): ChairPosition[] {
  // Round and six-sided tables read best with seats following their silhouette.
  if (shape === 'round' || shape === 'hex') {
    const start = -90;
    return Array.from({ length: count }, (_, index) => {
      const degrees = start + (360 / count) * index;
      const radians = (degrees * Math.PI) / 180;
      const radiusX = shape === 'round' ? 60 : 59;
      const radiusY = shape === 'round' ? 60 : 59;
      return {
        x: 50 + Math.cos(radians) * radiusX,
        y: 50 + Math.sin(radians) * radiusY,
        angle: degrees + 90,
      };
    });
  }

  // Rectangular tables place extension chairs along their long edges, with the
  // remaining chairs at the ends. This keeps 12-seat tables readable as tables
  // that extend beyond their standard eight-seat setup.
  const sideCount = Math.min(2, count);
  const edgeCount = count - sideCount;
  const topCount = Math.ceil(edgeCount / 2);
  const bottomCount = Math.floor(edgeCount / 2);
  const positions: ChairPosition[] = [];
  const addEdge = (amount: number, y: number, angle: number) => {
    for (let index = 0; index < amount; index += 1) {
      positions.push({ x: ((index + 1) / (amount + 1)) * 100, y, angle });
    }
  };
  addEdge(topCount, -10, 0);
  addEdge(bottomCount, 110, 180);
  if (sideCount >= 1) positions.push({ x: -8, y: 50, angle: 90 });
  if (sideCount >= 2) positions.push({ x: 108, y: 50, angle: -90 });
  return positions;
}

export interface FloorTable {
  tableId: number;
  label: string;
  capacity: number;
}

export interface TableDecoration {
  /** Extra class names on the table button (e.g. `sold-out`, `live`). */
  className?: string;
  /** Override the table's own colour (staff view colours by state). */
  accent?: string;
  /** Screen-reader name for the button. */
  ariaLabel: string;
  /** Hover / focus card. */
  tooltip: ReactNode;
  /** Small mark drawn on the table top, under the name (e.g. a booking count). */
  badge?: ReactNode;
}

interface Props {
  tables: FloorTable[];
  selectedId: number | null;
  onSelect: (tableId: number) => void;
  loading?: boolean;
  /** Shown in place of the tables when the list failed to load. */
  loadError?: boolean;
  onRetry?: () => void;
  decorate: (table: FloorTable) => TableDecoration;
}

/** A controller seen from above: the body and its two grips, in one outline. */
const PAD_PATH =
  'M9 2h24c4 0 6.5 3 7.5 7l1.4 11c.6 4.4-3.6 6.6-6.4 3.6L30.5 19h-19l-5 4.6C3.7 26.6-.5 24.4.1 20L1.5 9C2.5 5 5 2 9 2z';

/**
 * The PlayStation corner, drawn from above like everything else on the floor:
 * two armchairs (a controller left on one) facing the TV on its stand against
 * the right-hand wall. It is booked like a table, so it uses the tables'
 * button (position, hover card, selected halo) with this picture in place of
 * a table top and chairs.
 */
function CornerArt() {
  const { t } = useI18n();
  return (
    <>
      <span className="corner-art" aria-hidden="true">
        <i className="corner-chair corner-chair-a" />
        <i className="corner-chair corner-chair-b" />
        <svg className="corner-pad" viewBox="-2 -1 46 30">
          <path d={PAD_PATH} fill="#242424" transform="translate(1.4 1.8)" />
          <path d={PAD_PATH} fill="#fffaf1" stroke="#242424" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M8.4 7.4h3v-3h2.4v3h3v2.4h-3v3h-2.4v-3h-3z" fill="#242424" />
          <circle cx="16" cy="15" r="2.3" fill="#242424" />
          <circle cx="26" cy="15" r="2.3" fill="#242424" />
          <circle cx="31" cy="5.6" r="1.5" fill="#1177ee" />
          <circle cx="34.2" cy="8.8" r="1.5" fill="#f13619" />
          <circle cx="27.8" cy="8.8" r="1.5" fill="#ffd21c" />
          <circle cx="31" cy="12" r="1.5" fill="#f47700" />
        </svg>
        <i className="corner-stand">
          <b className="corner-tv" />
        </i>
      </span>
      <span className="corner-label">{t('bk.psShort')}</span>
    </>
  );
}

/** The corner as scenery, for when the table list has no corner (it is part
 *  of the room whether or not it can be booked). */
function StaticCorner() {
  const p = FLOOR_PLACEMENTS[CORNER_LABEL];
  const style = {
    '--table-x': `${p.x}%`,
    '--table-y': `${p.y}%`,
    '--table-angle': '0deg',
    '--table-accent': p.color,
  } as CSSProperties;
  return (
    <div className="floor-table floor-table-corner is-static" style={style} aria-hidden="true">
      <CornerArt />
    </div>
  );
}

export function CafeFloorPlan({
  tables,
  selectedId,
  onSelect,
  loading = false,
  loadError = false,
  onRetry,
  decorate,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="cafe-floor-viewport">
      <div className="cafe-floor-plan" aria-label={t('bk.floorPlan')}>
        <div className="floor-window floor-window-one" aria-hidden="true" />
        <div className="floor-window floor-window-two" aria-hidden="true" />
        <div className="floor-counter" aria-hidden="true">
          <span>{t('bk.counter')}</span>
          <i /><i /><i />
        </div>
        <div className="floor-shelf" aria-hidden="true">
          <span>{t('bk.gameWall')}</span>
        </div>
        {/* The D&D table sits in its own walled room, gated off from
            the main hall with a doorway — as in the real cafe. */}
        <div className="floor-room-dnd" aria-hidden="true">
          <span>{t('bk.dndRoom')}</span>
        </div>
        <img className="floor-brand-mark" src="/brand/cd-mark.png" alt="" aria-hidden="true" />
        <span className="floor-plant plant-one" aria-hidden="true">✦</span>
        <span className="floor-plant plant-two" aria-hidden="true">✦</span>
        <span className="floor-game-prop floor-die-prop" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="floor-game-prop floor-card-prop" aria-hidden="true">
          <b>A</b><em>♠</em>
        </span>
        <span className="floor-game-prop floor-door-prop" aria-hidden="true" />
        <span className="floor-game-prop floor-domino-prop" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        <span className="floor-entrance" aria-hidden="true">{t('bk.entrance')}</span>

        {loading && (
          <div className="floor-loading" aria-live="polite">
            <span className="floor-loading-die" aria-hidden="true">⚄</span>
            {t('bk.loadingTables')}
          </div>
        )}

        {!loading && loadError && (
          <div className="floor-loading floor-load-error" role="alert">
            <span className="floor-loading-die" aria-hidden="true">⚀</span>
            <strong>{t('bk.tablesUnavailable')}</strong>
            <span>{t('bk.tablesUnavailableSub')}</span>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                {t('bk.retryTables')}
              </button>
            )}
          </div>
        )}

        {!loading &&
          !loadError &&
          tables.map((tb, index) => {
            const placement = floorPlacement(tb.label, index);
            const selected = selectedId === tb.tableId;
            const chairs = chairPositions(placement.shape, tb.capacity);
            const deco = decorate(tb);
            // Tables low in the room would push their tooltip past the
            // floor's clipped edge, so those flip it above instead.
            const tipAbove = placement.y > 58;
            const style = {
              '--table-x': `${placement.x}%`,
              '--table-y': `${placement.y}%`,
              '--table-angle': `${placement.angle ?? 0}deg`,
              '--table-accent': deco.accent ?? placement.color,
            } as CSSProperties;
            return (
              <button
                key={tb.tableId}
                type="button"
                style={style}
                className={`floor-table floor-table-${placement.shape} ${selected ? 'selected' : ''} ${deco.className ?? ''} ${tipAbove ? 'tip-above' : ''}`}
                aria-pressed={selected}
                aria-label={deco.ariaLabel}
                onClick={() => onSelect(tb.tableId)}
              >
                <span className="table-shape-halo" aria-hidden="true" />
                {placement.shape === 'corner' ? (
                  <CornerArt />
                ) : (
                  <>
                <span className="table-seats" aria-hidden="true">
                  {chairs.map((chair, chairIndex) => (
                    <i
                      key={chairIndex}
                      style={{
                        '--chair-x': `${chair.x}%`,
                        '--chair-y': `${chair.y}%`,
                        '--chair-angle': `${chair.angle}deg`,
                      } as CSSProperties}
                    />
                  ))}
                </span>
                <span className="floor-table-surface">
                  <strong>{mapTableName(tb.label)}</strong>
                  <small>{t('bk.seatsShort', { n: tb.capacity })}</small>
                  {deco.badge}
                </span>
                  </>
                )}
                <span className="floor-table-tooltip" aria-hidden="true">
                  {deco.tooltip}
                </span>
              </button>
            );
          })}

        {!loading && !loadError && !tables.some((tb) => tb.label === CORNER_LABEL) && <StaticCorner />}
      </div>
    </div>
  );
}
