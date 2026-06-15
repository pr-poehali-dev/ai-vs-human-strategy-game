import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  SIZE,
  newGame,
  getMoves,
  getTargets,
  unitAt,
  applyDamage,
  cleanupDead,
  checkWinner,
  computeAIMove,
  aliveUnits,
  UNIT_INFO,
  MAX_HP,
  type GameState,
  type Unit,
  type Cell,
  type Owner,
} from '@/lib/game';

interface ShotAnim {
  id: number;
  fromR: number; fromC: number;
  toR: number; toC: number;
  color: string; // цвет луча
}

let animId = 0;

const Index = () => {
  const [state, setState] = useState<GameState>(() => newGame());
  const [turn, setTurn] = useState<Owner>(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [winner, setWinner] = useState<Owner | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [shots, setShots] = useState<ShotAnim[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setState(newGame());
    setTurn(1);
    setSelected(null);
    setWinner(null);
    setAiThinking(false);
    setShots([]);
  }, []);

  const addShot = useCallback((fromR: number, fromC: number, toR: number, toC: number, color: string) => {
    const shot: ShotAnim = { id: ++animId, fromR, fromC, toR, toC, color };
    setShots((s) => [...s, shot]);
    setTimeout(() => setShots((s) => s.filter((x) => x.id !== shot.id)), 500);
  }, []);

  const selectedUnit = useMemo(
    () => (selected != null ? state.units.find((u) => u.id === selected) : undefined),
    [selected, state],
  );
  const moveCells = useMemo<Cell[]>(
    () => (selectedUnit ? getMoves(state, selectedUnit) : []),
    [selectedUnit, state],
  );
  const targetUnits = useMemo<Unit[]>(
    () => (selectedUnit ? getTargets(state, selectedUnit) : []),
    [selectedUnit, state],
  );
  const moveSet = useMemo(() => new Set(moveCells.map((m) => `${m.r},${m.c}`)), [moveCells]);
  const targetSet = useMemo(() => new Set(targetUnits.map((t) => t.id)), [targetUnits]);

  const endTurn = useCallback((nextTurn: Owner) => {
    setSelected(null);
    setState((s) => {
      const w = checkWinner(s);
      if (w) { setWinner(w); return s; }
      setTurn(nextTurn);
      return s;
    });
  }, []);

  const playerShoot = useCallback((shooter: Unit, target: Unit) => {
    // Анимация основного выстрела
    const beamColor = shooter.type === 'arty' ? '#fbbf24' : '#4ade80';
    addShot(shooter.r, shooter.c, target.r, target.c, beamColor);

    setState((prev) => {
      const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
      applyDamage(s, target.id, UNIT_INFO[shooter.type].dmg);

      // Все артиллерии поддерживают залп
      const arties = aliveUnits(s, 1).filter((u) => u.type === 'arty' && u.id !== shooter.id);
      for (const art of arties) {
        const stillAlive = s.units.find((u) => u.id === target.id && u.hp > 0);
        if (!stillAlive) break;
        const canHit = getTargets(s, art).some((t) => t.id === target.id);
        if (canHit) {
          applyDamage(s, target.id, UNIT_INFO.arty.dmg);
          // Анимация поддерживающего залпа с задержкой
          setTimeout(() => addShot(art.r, art.c, target.r, target.c, '#fbbf24'), 120);
        }
      }
      cleanupDead(s);
      return s;
    });
    setTimeout(() => endTurn(2), 50);
  }, [addShot, endTurn]);

  const playerMove = useCallback((u: Unit, cell: Cell) => {
    setState((prev) => {
      const s: GameState = { mountains: prev.mountains, units: prev.units.map((x) => ({ ...x })) };
      const mover = s.units.find((x) => x.id === u.id)!;
      mover.r = cell.r;
      mover.c = cell.c;
      return s;
    });
    endTurn(2);
  }, [endTurn]);

  const handleCell = useCallback((r: number, c: number) => {
    if (turn !== 1 || winner || aiThinking) return;
    const clicked = unitAt(state.units, r, c);
    if (selectedUnit) {
      if (clicked && targetSet.has(clicked.id)) { playerShoot(selectedUnit, clicked); return; }
      if (moveSet.has(`${r},${c}`)) { playerMove(selectedUnit, { r, c }); return; }
    }
    if (clicked && clicked.owner === 1) {
      setSelected(clicked.id === selected ? null : clicked.id);
    } else {
      setSelected(null);
    }
  }, [turn, winner, aiThinking, state, selectedUnit, selected, targetSet, moveSet, playerShoot, playerMove]);

  // Ход ИИ
  useEffect(() => {
    if (turn !== 2 || winner) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      let shotFromR = -1, shotFromC = -1, shotToR = -1, shotToC = -1;
      let actorType: string = '';

      setState((prev) => {
        const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
        const action = computeAIMove(s);
        if (!action) return s;
        const actor = s.units.find((u) => u.id === action.unitId)!;
        actorType = actor.type;

        if (action.shootTargetId != null) {
          const tgt = s.units.find((u) => u.id === action.shootTargetId)!;
          shotFromR = actor.r; shotFromC = actor.c;
          shotToR = tgt.r; shotToC = tgt.c;
          applyDamage(s, action.shootTargetId, UNIT_INFO[actor.type].dmg);
          cleanupDead(s);
        } else if (action.move) {
          actor.r = action.move.r;
          actor.c = action.move.c;
          const targets = getTargets(s, actor);
          if (targets.length) {
            const tgt = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
            shotFromR = actor.r; shotFromC = actor.c;
            shotToR = tgt.r; shotToC = tgt.c;
            applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg);
            cleanupDead(s);
          }
        }
        return s;
      });

      // Анимация выстрела ИИ
      if (shotToR >= 0) {
        const color = actorType === 'arty' ? '#f87171' : '#f87171';
        addShot(shotFromR, shotFromC, shotToR, shotToC, color);
      }

      setTimeout(() => {
        setState((s) => {
          const w = checkWinner(s);
          if (w) setWinner(w);
          else setTurn(1);
          return s;
        });
        setAiThinking(false);
      }, 400);
    }, 300);
    return () => clearTimeout(t);
  }, [turn, winner, addShot]);

  return (
    <div className="w-screen h-screen wood-bg overflow-hidden flex items-center justify-center p-2">
      <div
        ref={boardRef}
        className="relative grid w-full h-full max-w-[100vmin] max-h-[100vmin] rounded-md overflow-hidden border-4 border-stone-950 shadow-2xl"
        style={{
          gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${SIZE}, 1fr)`,
          aspectRatio: '1 / 1',
        }}
      >
        {Array.from({ length: SIZE * SIZE }).map((_, idx) => {
          const r = Math.floor(idx / SIZE);
          const c = idx % SIZE;
          const u = unitAt(state.units, r, c);
          const isMountain = state.mountains[r][c];
          const isMove = moveSet.has(`${r},${c}`);
          const isTarget = u ? targetSet.has(u.id) : false;
          const isSelected = u && u.id === selected;
          const light = (r + c) % 2 === 0;
          return (
            <button
              key={idx}
              onClick={() => handleCell(r, c)}
              className={`relative ${light ? 'wood-light' : 'wood-dark'} border border-stone-900/30 flex items-center justify-center
                ${isSelected ? 'ring-4 ring-inset ring-amber-400 z-10' : ''}
                ${isTarget ? 'ring-4 ring-inset ring-rose-500 z-10' : ''}`}
            >
              {isMountain && <span className="text-2xl md:text-4xl select-none">⛰️</span>}
              {isMove && !u && (
                <span className="absolute w-1/4 h-1/4 rounded-full bg-emerald-400/80 shadow" />
              )}
              {u && (
                <>
                  <img
                    src={UNIT_INFO[u.type].icon}
                    alt={UNIT_INFO[u.type].name}
                    draggable={false}
                    className="w-[78%] h-[78%] object-contain select-none pointer-events-none"
                    style={{
                      filter: u.owner === 2
                        ? 'sepia(1) saturate(4) hue-rotate(310deg) brightness(0.9)'
                        : 'none',
                    }}
                  />
                  <span
                    className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full border border-black/40 ${
                      u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-500'
                    }`}
                  />
                  <span className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                    <span
                      className={`block h-full ${u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                      style={{ width: `${(u.hp / MAX_HP) * 100}%` }}
                    />
                  </span>
                </>
              )}
            </button>
          );
        })}

        {/* SVG оверлей с анимацией выстрелов */}
        <ShotOverlay shots={shots} size={SIZE} />
      </div>

      {winner && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in" onClick={reset}>
          <div className="bg-stone-900 border-4 border-amber-600 rounded-lg p-8 text-center max-w-sm mx-4 shadow-2xl">
            <div className="text-6xl mb-3">{winner === 1 ? '🏆' : '💀'}</div>
            <h2 className="font-display uppercase text-3xl tracking-wide mb-2 text-amber-50">
              {winner === 1 ? 'Победа!' : 'Поражение'}
            </h2>
            <button
              onClick={reset}
              className="font-display uppercase tracking-wider py-2 px-6 rounded bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold"
            >
              Новый бой
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Координаты центра клетки в % от поля
function cellCenter(r: number, c: number, size: number) {
  const pct = 100 / size;
  return {
    x: c * pct + pct / 2,
    y: r * pct + pct / 2,
  };
}

function ShotOverlay({ shots, size }: { shots: ShotAnim[]; size: number }) {
  if (shots.length === 0) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-20"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {shots.map((shot) => {
        const from = cellCenter(shot.fromR, shot.fromC, size);
        const to = cellCenter(shot.toR, shot.toC, size);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        return (
          <g key={shot.id}>
            {/* Пульс на стрелке */}
            <circle
              cx={from.x}
              cy={from.y}
              r="0"
              fill="none"
              stroke={shot.color}
              strokeWidth="0.8"
              className="shooter-pulse"
              style={{ transformOrigin: `${from.x}px ${from.y}px` }}
            />
            {/* Луч выстрела */}
            <line
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke={shot.color}
              strokeWidth="0.6"
              strokeLinecap="round"
              className="beam-line"
              style={{ '--beam-len': `${len}` } as React.CSSProperties}
            />
            {/* Вспышка на цели */}
            <circle
              cx={to.x}
              cy={to.y}
              r="0"
              fill={shot.color}
              opacity="0.85"
              className="flash-circle"
            />
            {/* Кольцо взрыва */}
            <circle
              cx={to.x}
              cy={to.y}
              r="0"
              fill="none"
              stroke={shot.color}
              strokeWidth="0.5"
              className="ring-circle"
            />
          </g>
        );
      })}
    </svg>
  );
}

export default Index;
