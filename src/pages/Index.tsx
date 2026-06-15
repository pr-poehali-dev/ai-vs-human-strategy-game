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

// Фазы хода игрока:
// 'select'      — ничего не выбрано, ждём выбора юнита
// 'tank-move'   — выбран танк, можно двигаться и/или стрелять
// 'tank-shot'   — танк выстрелил, ждём выбора артиллерии для поддержки
// 'arty-select' — выбрана артиллерия, показываем её цели
type Phase = 'select' | 'tank-move' | 'tank-shot' | 'arty-select';

interface ShotAnim {
  id: number;
  fromR: number; fromC: number;
  toR: number; toC: number;
  color: string;
}

let animId = 0;

const Index = () => {
  const [state, setState] = useState<GameState>(() => newGame());
  const [turn, setTurn] = useState<Owner>(1);
  const [winner, setWinner] = useState<Owner | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [shots, setShots] = useState<ShotAnim[]>([]);

  const [phase, setPhase] = useState<Phase>('select');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // State после движения танка (до подтверждения выстрела)
  const [movedState, setMovedState] = useState<GameState | null>(null);
  const [shotTargetPos, setShotTargetPos] = useState<{ r: number; c: number } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setState(newGame());
    setTurn(1);
    setWinner(null);
    setAiThinking(false);
    setShots([]);
    setPhase('select');
    setSelectedId(null);
    setMovedState(null);
    setShotTargetPos(null);
  }, []);

  const addShot = useCallback((fromR: number, fromC: number, toR: number, toC: number, color: string) => {
    const shot: ShotAnim = { id: ++animId, fromR, fromC, toR, toC, color };
    setShots((s) => [...s, shot]);
    setTimeout(() => setShots((s) => s.filter((x) => x.id !== shot.id)), 500);
  }, []);

  // Активный state для рендера и расчётов (после движения — movedState)
  const activeState = movedState ?? state;

  const selectedUnit = useMemo(
    () => selectedId != null ? activeState.units.find((u) => u.id === selectedId) : undefined,
    [selectedId, activeState],
  );

  // Ходы для выбранного танка (считаем от оригинального state, до движения)
  const moveCells = useMemo<Cell[]>(() => {
    if (phase !== 'tank-move' || movedState) return []; // после движения ходы не показываем
    if (!selectedUnit) return [];
    const orig = state.units.find((u) => u.id === selectedId);
    if (!orig) return [];
    return getMoves(state, orig);
  }, [phase, movedState, selectedUnit, selectedId, state]);

  // Цели для танка (с текущей позиции — после движения если двигался)
  const tankTargets = useMemo<Unit[]>(() => {
    if (phase !== 'tank-move' || !selectedUnit) return [];
    return getTargets(activeState, selectedUnit);
  }, [phase, selectedUnit, activeState]);

  // Доступные артиллерии для поддержки (фаза tank-shot)
  const supportArties = useMemo<Unit[]>(() => {
    if (phase !== 'tank-shot') return [];
    return aliveUnits(state, 1).filter((u) => u.type === 'arty');
  }, [phase, state]);

  // Цели для выбранной артиллерии (фаза arty-select)
  const artyTargets = useMemo<Unit[]>(() => {
    if (phase !== 'arty-select' || !selectedUnit) return [];
    return getTargets(state, selectedUnit);
  }, [phase, selectedUnit, state]);

  const moveSet = useMemo(() => new Set(moveCells.map((m) => `${m.r},${m.c}`)), [moveCells]);
  const tankTargetSet = useMemo(() => new Set(tankTargets.map((t) => t.id)), [tankTargets]);
  const supportArtySet = useMemo(() => new Set(supportArties.map((u) => u.id)), [supportArties]);
  const artyTargetSet = useMemo(() => new Set(artyTargets.map((t) => t.id)), [artyTargets]);

  // Завершение хода игрока
  const finishPlayerTurn = useCallback((finalState: GameState) => {
    setPhase('select');
    setSelectedId(null);
    setMovedState(null);
    setShotTargetPos(null);
    setState(finalState);
    const w = checkWinner(finalState);
    if (w) { setWinner(w); return; }
    setTurn(2);
  }, []);

  const handleCell = useCallback((r: number, c: number) => {
    if (turn !== 1 || winner || aiThinking) return;
    const clickedUnit = unitAt(activeState.units, r, c);

    // === SELECT: выбор любого своего юнита ===
    if (phase === 'select') {
      if (clickedUnit?.owner === 1) {
        setSelectedId(clickedUnit.id);
        setPhase('tank-move');
      }
      return;
    }

    // === TANK-MOVE: танк выбран ===
    if (phase === 'tank-move' && selectedUnit) {
      // Переключение на другой свой юнит
      if (clickedUnit?.owner === 1 && clickedUnit.id !== selectedId) {
        setSelectedId(clickedUnit.id);
        setMovedState(null);
        return;
      }

      // Выстрел по цели
      if (clickedUnit && tankTargetSet.has(clickedUnit.id)) {
        addShot(selectedUnit.r, selectedUnit.c, clickedUnit.r, clickedUnit.c, '#4ade80');
        const newS: GameState = {
          mountains: activeState.mountains,
          units: activeState.units.map((u) => ({ ...u })),
        };
        applyDamage(newS, clickedUnit.id, UNIT_INFO[selectedUnit.type].dmg);
        cleanupDead(newS);
        setShotTargetPos({ r: clickedUnit.r, c: clickedUnit.c });
        setState(newS);
        setMovedState(null);
        setSelectedId(null);
        setPhase('tank-shot');
        return;
      }

      // Движение на клетку
      if (moveSet.has(`${r},${c}`)) {
        const newS: GameState = {
          mountains: state.mountains,
          units: state.units.map((u) => ({ ...u })),
        };
        const mover = newS.units.find((u) => u.id === selectedId)!;
        mover.r = r;
        mover.c = c;
        setMovedState(newS);
        // Остаёмся в tank-move — теперь можно стрелять с новой позиции
        return;
      }

      // Клик в пустоту — если двигались, фиксируем движение и заканчиваем ход
      if (movedState) {
        finishPlayerTurn(movedState);
        return;
      }
      // Если не двигались — сброс
      setPhase('select');
      setSelectedId(null);
      return;
    }

    // === TANK-SHOT: танк выстрелил, выбираем артиллерию ===
    if (phase === 'tank-shot') {
      if (clickedUnit?.owner === 1 && supportArtySet.has(clickedUnit.id)) {
        setSelectedId(clickedUnit.id);
        setPhase('arty-select');
        return;
      }
      // Любой другой клик — конец хода
      finishPlayerTurn(state);
      return;
    }

    // === ARTY-SELECT: артиллерия выбрана ===
    if (phase === 'arty-select' && selectedUnit) {
      // Переключение на другую арту
      if (clickedUnit?.owner === 1 && clickedUnit.type === 'arty' && clickedUnit.id !== selectedId) {
        setSelectedId(clickedUnit.id);
        return;
      }
      // Выстрел артиллерии
      if (clickedUnit && artyTargetSet.has(clickedUnit.id)) {
        addShot(selectedUnit.r, selectedUnit.c, clickedUnit.r, clickedUnit.c, '#fbbf24');
        const newS: GameState = {
          mountains: state.mountains,
          units: state.units.map((u) => ({ ...u })),
        };
        applyDamage(newS, clickedUnit.id, UNIT_INFO.arty.dmg);
        cleanupDead(newS);
        finishPlayerTurn(newS);
        return;
      }
      // Пропуск — конец хода
      finishPlayerTurn(state);
      return;
    }
  }, [
    turn, winner, aiThinking, phase, selectedUnit, selectedId,
    activeState, state, movedState, moveSet, tankTargetSet,
    artyTargetSet, supportArtySet, addShot, finishPlayerTurn,
  ]);

  // Ход ИИ
  useEffect(() => {
    if (turn !== 2 || winner) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      let shotFrom = { r: -1, c: -1 }, shotTo = { r: -1, c: -1 };
      let actorType = '';

      setState((prev) => {
        const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
        const action = computeAIMove(s);
        if (!action) return s;
        const actor = s.units.find((u) => u.id === action.unitId)!;
        actorType = actor.type;

        if (action.shootTargetId != null) {
          const tgt = s.units.find((u) => u.id === action.shootTargetId)!;
          shotFrom = { r: actor.r, c: actor.c };
          shotTo = { r: tgt.r, c: tgt.c };
          applyDamage(s, action.shootTargetId, UNIT_INFO[actor.type].dmg);
          cleanupDead(s);
        } else if (action.move) {
          actor.r = action.move.r;
          actor.c = action.move.c;
          const targets = getTargets(s, actor);
          if (targets.length) {
            const tgt = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
            shotFrom = { r: actor.r, c: actor.c };
            shotTo = { r: tgt.r, c: tgt.c };
            applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg);
            cleanupDead(s);
          }
        }
        return s;
      });

      if (shotTo.r >= 0) {
        addShot(shotFrom.r, shotFrom.c, shotTo.r, shotTo.c, actorType === 'arty' ? '#fca5a5' : '#f87171');
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
    }, 350);
    return () => clearTimeout(t);
  }, [turn, winner, addShot]);

  const phaseHint = useMemo(() => {
    if (turn === 2 || aiThinking) return 'ИИ ходит…';
    if (phase === 'select') return 'Выберите юнит';
    if (phase === 'tank-move') return movedState ? 'Стреляйте или кликните пустое поле' : 'Двигайтесь или стреляйте';
    if (phase === 'tank-shot') return 'Выберите артиллерию для залпа или кликните пустое поле';
    if (phase === 'arty-select') return 'Выберите цель для артиллерии';
    return '';
  }, [turn, aiThinking, phase, movedState]);

  return (
    <div className="w-screen h-screen wood-bg overflow-hidden flex flex-col items-center justify-center gap-2 p-2">
      <div className="font-display uppercase tracking-widest text-xs text-amber-200/80 bg-stone-900/50 px-4 py-1 rounded-full select-none">
        {phaseHint}
      </div>

      <div
        ref={boardRef}
        className="relative grid rounded-md overflow-hidden border-4 border-stone-950 shadow-2xl"
        style={{
          width: 'min(96vmin, 96vw)',
          height: 'min(96vmin, 96vh)',
          gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${SIZE}, 1fr)`,
        }}
      >
        {Array.from({ length: SIZE * SIZE }).map((_, idx) => {
          const r = Math.floor(idx / SIZE);
          const c = idx % SIZE;
          const u = unitAt(activeState.units, r, c);
          const isMountain = activeState.mountains[r][c];
          const isMove = moveSet.has(`${r},${c}`);
          const isTankTarget = u ? tankTargetSet.has(u.id) : false;
          const isArtyTarget = u ? artyTargetSet.has(u.id) : false;
          const isSelected = u?.id === selectedId;
          const isSupportArty = u ? supportArtySet.has(u.id) : false;
          const isShotTarget = shotTargetPos && r === shotTargetPos.r && c === shotTargetPos.c;
          const light = (r + c) % 2 === 0;

          return (
            <button
              key={idx}
              onClick={() => handleCell(r, c)}
              className={[
                'relative flex items-center justify-center border border-stone-900/30',
                light ? 'wood-light' : 'wood-dark',
                isSelected ? 'ring-4 ring-inset ring-amber-400 z-10' : '',
                isTankTarget ? 'ring-4 ring-inset ring-rose-500 z-10' : '',
                isArtyTarget ? 'ring-4 ring-inset ring-yellow-400 z-10' : '',
                isSupportArty && phase === 'tank-shot' ? 'ring-4 ring-inset ring-amber-300 z-10' : '',
                isShotTarget ? 'bg-orange-400/20' : '',
              ].filter(Boolean).join(' ')}
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
                  <span className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full border border-black/40 ${u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-500'}`} />
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

        <ShotOverlay shots={shots} size={SIZE} />
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

function cellCenter(r: number, c: number, size: number) {
  const pct = 100 / size;
  return { x: c * pct + pct / 2, y: r * pct + pct / 2 };
}

function ShotOverlay({ shots, size }: { shots: ShotAnim[]; size: number }) {
  if (shots.length === 0) return null;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-20" viewBox="0 0 100 100" preserveAspectRatio="none">
      {shots.map((shot) => {
        const from = cellCenter(shot.fromR, shot.fromC, size);
        const to = cellCenter(shot.toR, shot.toC, size);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        return (
          <g key={shot.id}>
            <circle cx={from.x} cy={from.y} r="0" fill="none" stroke={shot.color} strokeWidth="0.8" className="shooter-pulse" />
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={shot.color} strokeWidth="0.6" strokeLinecap="round" className="beam-line" style={{ '--beam-len': `${len}` } as React.CSSProperties} />
            <circle cx={to.x} cy={to.y} r="0" fill={shot.color} opacity="0.85" className="flash-circle" />
            <circle cx={to.x} cy={to.y} r="0" fill="none" stroke={shot.color} strokeWidth="0.5" className="ring-circle" />
          </g>
        );
      })}
    </svg>
  );
}

export default Index;
