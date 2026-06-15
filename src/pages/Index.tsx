import { useEffect, useMemo, useState, useCallback } from 'react';
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

const Index = () => {
  const [state, setState] = useState<GameState>(() => newGame());
  const [turn, setTurn] = useState<Owner>(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [winner, setWinner] = useState<Owner | null>(null);
  const [aiThinking, setAiThinking] = useState(false);

  const reset = useCallback(() => {
    setState(newGame());
    setTurn(1);
    setSelected(null);
    setWinner(null);
    setAiThinking(false);
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

  const endTurn = useCallback(() => {
    setSelected(null);
    setState((s) => {
      const w = checkWinner(s);
      if (w) { setWinner(w); return s; }
      setTurn(2);
      return s;
    });
  }, []);

  const playerShoot = useCallback((shooter: Unit, target: Unit) => {
    setState((prev) => {
      const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
      applyDamage(s, target.id, UNIT_INFO[shooter.type].dmg);
      if (shooter.type !== 'arty') {
        const arties = aliveUnits(s, 1).filter((u) => u.type === 'arty');
        for (const art of arties) {
          const canHit = getTargets(s, art).some((t) => t.id === target.id);
          const stillAlive = s.units.find((u) => u.id === target.id && u.hp > 0);
          if (canHit && stillAlive) {
            applyDamage(s, target.id, UNIT_INFO.arty.dmg);
            break;
          }
        }
      }
      cleanupDead(s);
      return s;
    });
    endTurn();
  }, [endTurn]);

  const playerMove = useCallback((u: Unit, cell: Cell) => {
    setState((prev) => {
      const s: GameState = { mountains: prev.mountains, units: prev.units.map((x) => ({ ...x })) };
      const mover = s.units.find((x) => x.id === u.id)!;
      mover.r = cell.r;
      mover.c = cell.c;
      return s;
    });
    endTurn();
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

  // Ход ИИ — автоматически после хода человека
  useEffect(() => {
    if (turn !== 2 || winner) return;
    setAiThinking(true);
    const t = setTimeout(() => {
      setState((prev) => {
        const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
        const action = computeAIMove(s);
        if (!action) return s;
        const actor = s.units.find((u) => u.id === action.unitId)!;
        if (action.shootTargetId != null) {
          applyDamage(s, action.shootTargetId, UNIT_INFO[actor.type].dmg);
          cleanupDead(s);
        } else if (action.move) {
          actor.r = action.move.r;
          actor.c = action.move.c;
          const targets = getTargets(s, actor);
          if (targets.length) {
            const tgt = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
            applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg);
            cleanupDead(s);
          }
        }
        return s;
      });
      setState((s) => {
        const w = checkWinner(s);
        if (w) setWinner(w);
        else setTurn(1);
        return s;
      });
      setAiThinking(false);
    }, 450);
    return () => clearTimeout(t);
  }, [turn, winner]);

  return (
    <div className="w-screen h-screen wood-bg overflow-hidden flex items-center justify-center p-2">
      <div
        className="grid w-full h-full max-w-[100vmin] max-h-[100vmin] rounded-md overflow-hidden border-4 border-stone-950 shadow-2xl"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gridTemplateRows: `repeat(${SIZE}, 1fr)`, aspectRatio: '1 / 1' }}
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

export default Index;
