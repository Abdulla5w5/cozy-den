import { type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../i18n';

// The café drawn as a room, with one button per table. Shared by the customer
// booking form and the staff day view: both show the same floor, they just
// colour the tables differently (free times vs. who is sitting there), so the
// per-table look is handed in by the caller through `decorate`.

// square: a small four-top. wide: a long rectangle. hex: the six-sided table.
// round: a circle. hall: the long room-filling table behind the D&D door.
type FloorShape = 'square' | 'round' | 'wide' | 'hex' | 'hall';

interface FloorPlacement {
  x: number;
  y: number;
  shape: FloorShape;
  /** The table top's colour. Shape and colour are set per table, not tied. */
  color: string;
  angle?: number;
}

const GREEN = '#2d8b57';
const RED = '#e03a1f';
const BLUE = '#1177ee';
const BROWN = '#a86a34';
const BLACK = '#3a3a3a';

// These coordinates describe the physical cafe sketch, not booking data. The
// API remains the source of truth for which tables exist and which slots are
// free; an unknown future table still receives a sensible fallback position.
// Keyed by the table's current name, so a rename in the database must be
// mirrored here for the table to stay where it physically is.
const FLOOR_PLACEMENTS: Record<string, FloorPlacement> = {
  'Small Table 1': { x: 80, y: 50, shape: 'square', color: GREEN, angle: 1 },
  'Small Table 2': { x: 52, y: 39, shape: 'square', color: GREEN, angle: 0 },
  'Small Table 3': { x: 65, y: 18, shape: 'square', color: RED, angle: -1 },
  'Big Table 1': { x: 72, y: 82, shape: 'wide', color: GREEN, angle: 0 },
  'Big Table 2': { x: 53, y: 65, shape: 'hex', color: BLUE, angle: 0 },
  'Big Table 3': { x: 38, y: 18, shape: 'wide', color: RED, angle: 0 },
  'Big Table 4 (D&D)': { x: 20, y: 80, shape: 'hall', color: BLACK, angle: 0 },
  'Floor Table': { x: 85, y: 19, shape: 'round', color: BROWN, angle: 0 },
};

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
                <span className="floor-table-tooltip" aria-hidden="true">
                  {deco.tooltip}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
