import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  COLS, ROWS,
  newGame, getMoves, getTargets, unitAt,
  applyDamage, cleanupDead, checkWinner, computeAIMove, aliveUnits,
  UNIT_INFO, MAX_HP,
  type GameState, type Unit, type Cell, type Owner,
} from '@/lib/game';

// Фазы хода:
// 'select'      — ничего не выбрано
// 'first-shot'  — юнит выбран, ждём первый выстрел (или движение ЛТ)
// 'second-shot' — первый выстрел сделан, ждём выстрел артиллерии
type Phase = 'select' | 'first-shot' | 'second-shot';

interface ShotAnim {
  id: number; fromR: number; fromC: number; toR: number; toC: number; color: string;
}

let animId = 0;
const ARTY_COLOR    = '#fbbf24';
const TANK_COLOR    = '#4ade80';
const AI_COLOR      = '#f87171';
const AI_ARTY_COLOR = '#fca5a5';

const Index = () => {
  const [state, setState]         = useState<GameState>(() => newGame());
  const [turn, setTurn]           = useState<Owner>(1);
  const [winner, setWinner]       = useState<Owner | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [shots, setShots]         = useState<ShotAnim[]>([]);
  const [phase, setPhase]         = useState<Phase>('select');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [firstShooterType, setFirstShooterType] = useState<'light' | 'arty' | null>(null);
  const [movedState, setMovedState] = useState<GameState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setState(newGame()); setTurn(1); setWinner(null); setAiThinking(false);
    setShots([]); setPhase('select'); setSelectedId(null);
    setFirstShooterType(null); setMovedState(null);
  }, []);

  const addShot = useCallback((fromR: number, fromC: number, toR: number, toC: number, color: string) => {
    const shot: ShotAnim = { id: ++animId, fromR, fromC, toR, toC, color };
    setShots(s => [...s, shot]);
    setTimeout(() => setShots(s => s.filter(x => x.id !== shot.id)), 1600);
  }, []);

  const activeState = movedState ?? state;

  const selectedUnit = useMemo(
    () => selectedId != null ? activeState.units.find(u => u.id === selectedId) : undefined,
    [selectedId, activeState],
  );

  const moveCells = useMemo<Cell[]>(() => {
    if (phase !== 'first-shot' || movedState || !selectedUnit || selectedUnit.type === 'arty') return [];
    const orig = state.units.find(u => u.id === selectedId);
    return orig ? getMoves(state, orig) : [];
  }, [phase, movedState, selectedUnit, selectedId, state]);

  const currentTargets = useMemo<Unit[]>(() => {
    if (!selectedUnit || phase === 'select') return [];
    return getTargets(activeState, selectedUnit);
  }, [selectedUnit, phase, activeState]);

  const availableArties = useMemo<Unit[]>(() => {
    if (phase !== 'second-shot') return [];
    return aliveUnits(state, 1).filter(u => u.type === 'arty');
  }, [phase, state]);

  const moveSet   = useMemo(() => new Set(moveCells.map(m => `${m.r},${m.c}`)), [moveCells]);
  const targetSet = useMemo(() => new Set(currentTargets.map(t => t.id)),       [currentTargets]);
  const artySet   = useMemo(() => new Set(availableArties.map(u => u.id)),      [availableArties]);

  const finishTurn = useCallback((finalState: GameState) => {
    setPhase('select'); setSelectedId(null);
    setFirstShooterType(null); setMovedState(null);
    setState(finalState);
    const w = checkWinner(finalState);
    if (w) { setWinner(w); return; }
    setTurn(2);
  }, []);

  const handleCell = useCallback((r: number, c: number) => {
    if (turn !== 1 || winner || aiThinking) return;
    const clicked = unitAt(activeState.units, r, c);

    if (phase === 'select') {
      if (clicked?.owner === 1) { setSelectedId(clicked.id); setPhase('first-shot'); }
      return;
    }

    if (phase === 'first-shot' && selectedUnit) {
      if (clicked?.owner === 1 && clicked.id !== selectedId) {
        setSelectedId(clicked.id); setMovedState(null); return;
      }
      if (clicked && targetSet.has(clicked.id)) {
        const color = selectedUnit.type === 'arty' ? ARTY_COLOR : TANK_COLOR;
        addShot(selectedUnit.r, selectedUnit.c, clicked.r, clicked.c, color);
        const newS: GameState = { mountains: activeState.mountains, units: activeState.units.map(u => ({ ...u })) };
        applyDamage(newS, clicked.id, UNIT_INFO[selectedUnit.type].dmg);
        cleanupDead(newS);
        setState(newS); setMovedState(null);
        setFirstShooterType(selectedUnit.type);
        setSelectedId(null); setPhase('second-shot');
        return;
      }
      if (selectedUnit.type === 'light' && moveSet.has(`${r},${c}`)) {
        const newS: GameState = { mountains: state.mountains, units: state.units.map(u => ({ ...u })) };
        newS.units.find(u => u.id === selectedId)!.r = r;
        newS.units.find(u => u.id === selectedId)!.c = c;
        setMovedState(newS); return;
      }
      if (movedState) { finishTurn(movedState); return; }
      setPhase('select'); setSelectedId(null); return;
    }

    if (phase === 'second-shot') {
      // Выбрать артиллерию
      if (clicked?.owner === 1 && clicked.type === 'arty' && artySet.has(clicked.id)) {
        setSelectedId(clicked.id); return;
      }
      // Выстрел артиллерией
      if (selectedUnit?.type === 'arty' && clicked && targetSet.has(clicked.id)) {
        addShot(selectedUnit.r, selectedUnit.c, clicked.r, clicked.c, ARTY_COLOR);
        const newS: GameState = { mountains: state.mountains, units: state.units.map(u => ({ ...u })) };
        applyDamage(newS, clicked.id, UNIT_INFO.arty.dmg);
        cleanupDead(newS); finishTurn(newS); return;
      }
      // Любой другой клик — конец хода
      finishTurn(state); return;
    }
  }, [
    turn, winner, aiThinking, phase, selectedUnit, selectedId,
    activeState, state, movedState, moveSet, targetSet, artySet,
    addShot, finishTurn,
  ]);

  // Ход ИИ
  useEffect(() => {
    if (turn !== 2 || winner) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      let shotFrom = { r: -1, c: -1 }, shotTo = { r: -1, c: -1 }, actorType = '';
      setState(prev => {
        const s: GameState = { mountains: prev.mountains, units: prev.units.map(u => ({ ...u })) };
        const action = computeAIMove(s);
        if (!action) return s;
        const actor = s.units.find(u => u.id === action.unitId)!;
        actorType = actor.type;
        if (action.shootTargetId != null) {
          const tgt = s.units.find(u => u.id === action.shootTargetId)!;
          shotFrom = { r: actor.r, c: actor.c }; shotTo = { r: tgt.r, c: tgt.c };
          applyDamage(s, action.shootTargetId, UNIT_INFO[actor.type].dmg);
          cleanupDead(s);
        } else if (action.move) {
          actor.r = action.move.r; actor.c = action.move.c;
          const targets = getTargets(s, actor);
          if (targets.length) {
            const tgt = targets.reduce((a, b) => b.hp < a.hp ? b : a);
            shotFrom = { r: actor.r, c: actor.c }; shotTo = { r: tgt.r, c: tgt.c };
            applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg); cleanupDead(s);
          }
        }
        return s;
      });
      if (shotTo.r >= 0)
        addShot(shotFrom.r, shotFrom.c, shotTo.r, shotTo.c, actorType === 'arty' ? AI_ARTY_COLOR : AI_COLOR);
      setTimeout(() => {
        setState(s => { const w = checkWinner(s); if (w) setWinner(w); else setTurn(1); return s; });
        setAiThinking(false);
      }, 1400);
    }, 300);
    return () => clearTimeout(t);
  }, [turn, winner, addShot]);

  const hint = useMemo(() => {
    if (turn === 2 || aiThinking) return 'ИИ ходит…';
    if (phase === 'select') return 'Выберите юнит';
    if (phase === 'first-shot') return movedState ? 'Стреляйте или кликните поле' : 'Двигайтесь или стреляйте';
    if (phase === 'second-shot') {
      if (!selectedUnit) return firstShooterType === 'arty'
        ? 'Выберите артиллерию для 2-го залпа или кликните поле'
        : 'Выберите артиллерию для поддержки или кликните поле';
      return 'Выберите цель для артиллерии';
    }
    return '';
  }, [turn, aiThinking, phase, selectedUnit, movedState, firstShooterType]);

  return (
    <div className="w-screen h-screen wood-bg overflow-hidden flex flex-col items-center justify-center gap-2 p-2">
      <div className="font-display uppercase tracking-widest text-xs text-amber-200/80 bg-stone-900/50 px-4 py-1 rounded-full select-none">
        {hint}
      </div>
      <div
        ref={boardRef}
        className="relative grid rounded-md overflow-hidden border-4 border-stone-950 shadow-2xl"
        style={{
          width:  `min(${(COLS / ROWS) * 96}vh, 96vw)`,
          height: `min(96vh, ${(ROWS / COLS) * 96}vw)`,
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows:    `repeat(${ROWS}, 1fr)`,
        }}
      >
        {Array.from({ length: ROWS * COLS }).map((_, idx) => {
          const r = Math.floor(idx / COLS), c = idx % COLS;
          const u = unitAt(activeState.units, r, c);
          const isMountain = activeState.mountains[r][c];
          const isMove     = moveSet.has(`${r},${c}`);
          const isTarget   = u ? targetSet.has(u.id) : false;
          const isSelected = u?.id === selectedId;
          const isArty     = u ? artySet.has(u.id) : false;
          const light = (r + c) % 2 === 0;
          return (
            <button
              key={idx}
              onClick={() => handleCell(r, c)}
              className={[
                'relative flex items-center justify-center border border-stone-900/30',
                light ? 'wood-light' : 'wood-dark',
                isSelected ? 'ring-4 ring-inset ring-amber-400 z-10' : '',
                isTarget   ? 'ring-4 ring-inset ring-rose-500 z-10'  : '',
                isArty && phase === 'second-shot' && !selectedUnit ? 'ring-4 ring-inset ring-yellow-300 z-10' : '',
              ].filter(Boolean).join(' ')}
            >
              {isMountain && <span className="text-xl md:text-3xl select-none">⛰️</span>}
              {isMove && !u && <span className="absolute w-1/4 h-1/4 rounded-full bg-emerald-400/80 shadow" />}
              {u && (
                <>
                  <img
                    src={UNIT_INFO[u.type].icon} alt={UNIT_INFO[u.type].name}
                    draggable={false}
                    className="w-[78%] h-[78%] object-contain select-none pointer-events-none"
                    style={{ filter: u.owner === 2 ? 'sepia(1) saturate(4) hue-rotate(310deg) brightness(0.9)' : 'none' }}
                  />
                  <span className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full border border-black/40 ${u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                  <span className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                    <span className={`block h-full ${u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                      style={{ width: `${(u.hp / MAX_HP) * 100}%` }} />
                  </span>
                </>
              )}
            </button>
          );
        })}
        <ShotOverlay shots={shots} cols={COLS} rows={ROWS} />
      </div>

      {winner && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in" onClick={reset}>
          <div className="bg-stone-900 border-4 border-amber-600 rounded-lg p-8 text-center max-w-sm mx-4 shadow-2xl">
            <div className="text-6xl mb-3">{winner === 1 ? '🏆' : '💀'}</div>
            <h2 className="font-display uppercase text-3xl tracking-wide mb-2 text-amber-50">
              {winner === 1 ? 'Победа!' : 'Поражение'}
            </h2>
            <button onClick={reset} className="font-display uppercase tracking-wider py-2 px-6 rounded bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold">
              Новый бой
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function cellCenter(r: number, c: number, rows: number, cols: number) {
  return { x: (c / cols) * 100 + (100 / cols) / 2, y: (r / rows) * 100 + (100 / rows) / 2 };
}

function ShotOverlay({ shots, cols, rows }: { shots: ShotAnim[]; cols: number; rows: number }) {
  if (!shots.length) return null;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-20" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="0.6" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {shots.map(shot => {
        const from = cellCenter(shot.fromR, shot.fromC, rows, cols);
        const to   = cellCenter(shot.toR,   shot.toC,   rows, cols);
        const len  = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
        return (
          <g key={shot.id} filter="url(#glow)">
            <circle cx={from.x} cy={from.y} r="0" fill="none" stroke={shot.color} strokeWidth="1" className="shooter-pulse"/>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={shot.color} strokeWidth="0.9" strokeLinecap="round"
              className="beam-line" style={{ '--beam-len': `${len}` } as React.CSSProperties}/>
            <circle cx={to.x} cy={to.y} r="0" fill={shot.color} opacity="0.9" className="flash-circle"/>
            <circle cx={to.x} cy={to.y} r="0" fill="none" stroke={shot.color} strokeWidth="0.6" className="ring-circle"/>
          </g>
        );
      })}
    </svg>
  );
}

export default Index;
