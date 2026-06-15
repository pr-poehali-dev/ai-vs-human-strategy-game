import { useEffect, useMemo, useState, useCallback } from 'react';
import Icon from '@/components/ui/icon';
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
  const [log, setLog] = useState<string[]>(['Бой начался. Ваш ход.']);

  const reset = useCallback(() => {
    setState(newGame());
    setTurn(1);
    setSelected(null);
    setWinner(null);
    setAiThinking(false);
    setLog(['Новый бой. Ваш ход.']);
  }, []);

  const pushLog = useCallback((msg: string) => {
    setLog((l) => [msg, ...l].slice(0, 8));
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

  // Игрок стреляет
  const playerShoot = useCallback((shooter: Unit, target: Unit) => {
    setState((prev) => {
      const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
      const dmg = UNIT_INFO[shooter.type].dmg;
      applyDamage(s, target.id, dmg);
      pushLog(`${UNIT_INFO[shooter.type].label} → попадание ${dmg} по врагу`);

      // Совместная стрельба артиллерии (только танки инициируют)
      if (shooter.type !== 'arty') {
        const arties = aliveUnits(s, 1).filter((u) => u.type === 'arty');
        for (const art of arties) {
          const canHit = getTargets(s, art).some((t) => t.id === target.id);
          const stillAlive = s.units.find((u) => u.id === target.id && u.hp > 0);
          if (canHit && stillAlive) {
            applyDamage(s, target.id, UNIT_INFO.arty.dmg);
            pushLog(`АРТ поддержала залп: +${UNIT_INFO.arty.dmg}`);
            break;
          }
        }
      }
      cleanupDead(s);
      return s;
    });
    endTurn();
  }, [pushLog, endTurn]);

  // Игрок двигает
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

  // Клик по клетке
  const handleCell = useCallback((r: number, c: number) => {
    if (turn !== 1 || winner || aiThinking) return;
    const clicked = unitAt(state.units, r, c);

    if (selectedUnit) {
      if (clicked && targetSet.has(clicked.id)) {
        playerShoot(selectedUnit, clicked);
        return;
      }
      if (moveSet.has(`${r},${c}`)) {
        playerMove(selectedUnit, { r, c });
        return;
      }
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
      setState((prev) => {
        const s: GameState = { mountains: prev.mountains, units: prev.units.map((u) => ({ ...u })) };
        const action = computeAIMove(s);
        if (!action) { return s; }
        const actor = s.units.find((u) => u.id === action.unitId)!;

        if (action.shootTargetId != null) {
          const tgt = s.units.find((u) => u.id === action.shootTargetId)!;
          applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg);
          pushLog(`ИИ: ${UNIT_INFO[actor.type].label} стреляет (${UNIT_INFO[actor.type].dmg})`);
          cleanupDead(s);
        } else if (action.move) {
          actor.r = action.move.r;
          actor.c = action.move.c;
          // после хода — пробуем выстрелить
          const targets = getTargets(s, actor);
          if (targets.length) {
            const tgt = targets.reduce((a, b) => (b.hp < a.hp ? b : a));
            applyDamage(s, tgt.id, UNIT_INFO[actor.type].dmg);
            pushLog(`ИИ: ${UNIT_INFO[actor.type].label} наступает и стреляет`);
            cleanupDead(s);
          } else {
            pushLog(`ИИ: ${UNIT_INFO[actor.type].label} наступает`);
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
  }, [turn, winner, pushLog]);

  const p1count = aliveUnits(state, 1).length;
  const p2count = aliveUnits(state, 2).length;

  return (
    <div className="min-h-screen wood-bg text-stone-100 font-body py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-5">
          <h1 className="font-display font-bold text-4xl md:text-5xl tracking-wide uppercase text-amber-50 drop-shadow-[0_2px_0_rgba(0,0,0,0.5)]">
            Танковая дуэль
          </h1>
          <p className="text-amber-200/70 font-display tracking-[0.3em] text-xs uppercase mt-1">
            Человек против ИИ · 11×11
          </p>
        </header>

        <div className="grid lg:grid-cols-[1fr_280px] gap-5 items-start">
          {/* Доска */}
          <div className="flex justify-center">
            <div className="inline-block p-3 rounded-md bg-stone-900/40 border-4 border-stone-950 shadow-2xl">
              <Board
                state={state}
                moveSet={moveSet}
                targetSet={targetSet}
                selectedId={selected}
                onCell={handleCell}
              />
            </div>
          </div>

          {/* Боковая панель */}
          <aside className="space-y-4">
            <div className="rounded-md bg-stone-900/60 border border-stone-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display uppercase tracking-wider text-sm text-amber-200">Ход</span>
                <span
                  className={`font-display font-semibold uppercase text-sm px-3 py-1 rounded ${
                    winner ? 'bg-stone-700 text-stone-300'
                    : turn === 1 ? 'bg-emerald-600 text-white' : 'bg-rose-700 text-white'
                  }`}
                >
                  {winner ? 'Конец' : turn === 1 ? 'Ваш' : 'ИИ…'}
                </span>
              </div>
              <div className="space-y-2 text-sm">
                <ScoreRow label="Вы (снизу)" count={p1count} color="bg-emerald-500" />
                <ScoreRow label="ИИ (сверху)" count={p2count} color="bg-rose-500" />
              </div>
            </div>

            <Legend />

            <button
              onClick={reset}
              className="w-full font-display uppercase tracking-wider text-sm py-3 rounded-md bg-amber-600 hover:bg-amber-500 transition-colors text-stone-950 font-semibold shadow-lg flex items-center justify-center gap-2"
            >
              <Icon name="RotateCcw" size={18} />
              Сбросить игру
            </button>

            <div className="rounded-md bg-stone-900/60 border border-stone-700 p-3">
              <div className="font-display uppercase tracking-wider text-xs text-amber-200/70 mb-2">Журнал боя</div>
              <ul className="space-y-1 text-xs text-stone-300">
                {log.map((l, i) => (
                  <li key={i} className={i === 0 ? 'text-amber-100' : 'opacity-60'}>· {l}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {winner && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in" onClick={reset}>
          <div className="bg-stone-900 border-4 border-amber-600 rounded-lg p-8 text-center max-w-sm mx-4 shadow-2xl">
            <div className="text-6xl mb-3">{winner === 1 ? '🏆' : '💀'}</div>
            <h2 className="font-display uppercase text-3xl tracking-wide mb-2 text-amber-50">
              {winner === 1 ? 'Победа!' : 'Поражение'}
            </h2>
            <p className="text-stone-400 mb-5">
              {winner === 1 ? 'Вы разбили армию ИИ.' : 'ИИ уничтожил ваши войска.'}
            </p>
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

function ScoreRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-300">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <span className="font-display font-semibold text-amber-100">{count}</span>
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div className="rounded-md bg-stone-900/60 border border-stone-700 p-4 space-y-2 text-xs">
      <div className="font-display uppercase tracking-wider text-amber-200/70 mb-1">Юниты</div>
      {(['light', 'heavy', 'arty'] as const).map((t) => (
        <div key={t} className="flex items-center gap-2 text-stone-300">
          <span className="text-base">{UNIT_INFO[t].icon}</span>
          <span className="font-semibold text-amber-100 w-8">{UNIT_INFO[t].label}</span>
          <span className="opacity-70">{UNIT_INFO[t].name} · {UNIT_INFO[t].dmg} урон</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-stone-300 pt-1">
        <span className="text-base">⛰️</span>
        <span className="opacity-70">Гора — непроходима</span>
      </div>
    </div>
  );
}

interface BoardProps {
  state: GameState;
  moveSet: Set<string>;
  targetSet: Set<number>;
  selectedId: number | null;
  onCell: (r: number, c: number) => void;
}

function Board({ state, moveSet, targetSet, selectedId, onCell }: BoardProps) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    const cells = [];
    for (let c = 0; c < SIZE; c++) {
      const u = unitAt(state.units, r, c);
      const isMountain = state.mountains[r][c];
      const isMove = moveSet.has(`${r},${c}`);
      const isTarget = u ? targetSet.has(u.id) : false;
      const isSelected = u && u.id === selectedId;
      const light = (r + c) % 2 === 0;

      cells.push(
        <button
          key={c}
          onClick={() => onCell(r, c)}
          className={`relative ${light ? 'wood-light' : 'wood-dark'} border border-stone-900/40 flex items-center justify-center transition-all
            ${isSelected ? 'ring-2 ring-inset ring-amber-400 z-10' : ''}
            ${isTarget ? 'ring-2 ring-inset ring-rose-500' : ''}`}
          style={{ width: 'clamp(26px, 5.6vw, 46px)', height: 'clamp(26px, 5.6vw, 46px)' }}
        >
          {isMountain && <span className="text-lg md:text-2xl select-none">⛰️</span>}

          {isMove && !u && (
            <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400/80 shadow" />
          )}

          {u && (
            <div className="flex flex-col items-center justify-center w-full h-full select-none">
              <span
                className={`leading-none ${u.owner === 1 ? '' : 'grayscale-[0.3]'} text-base md:text-xl`}
                style={{ filter: u.owner === 2 ? 'hue-rotate(140deg)' : 'none' }}
              >
                {UNIT_INFO[u.type].icon}
              </span>
              <span
                className={`text-[7px] md:text-[9px] font-display font-bold leading-none mt-0.5 px-1 rounded-sm ${
                  u.owner === 1 ? 'bg-emerald-700 text-emerald-50' : 'bg-rose-800 text-rose-50'
                }`}
              >
                {UNIT_INFO[u.type].label}
              </span>
              <span className="absolute bottom-0 left-0 right-0 h-1">
                <span
                  className={`block h-full ${u.owner === 1 ? 'bg-emerald-400' : 'bg-rose-400'}`}
                  style={{ width: `${(u.hp / MAX_HP) * 100}%` }}
                />
              </span>
            </div>
          )}
        </button>,
      );
    }
    rows.push(
      <div key={r} className="flex">
        {cells}
      </div>,
    );
  }
  return <div className="select-none">{rows}</div>;
}

export default Index;