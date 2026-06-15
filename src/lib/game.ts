export const COLS = 8;  // ширина
export const ROWS = 14; // высота

// Обратная совместимость — SIZE больше не используется
export const SIZE = COLS;

export type Owner = 1 | 2; // 1 = человек (снизу), 2 = ИИ (сверху)
export type UnitType = 'light' | 'heavy' | 'arty';

export interface Unit {
  id: number;
  owner: Owner;
  type: UnitType;
  hp: number;
  r: number;
  c: number;
}

export interface Cell {
  r: number;
  c: number;
}

export interface GameState {
  mountains: boolean[][];
  units: Unit[];
}

export const MAX_HP = 100;

export const UNIT_INFO: Record<UnitType, { dmg: number; label: string; icon: string; name: string }> = {
  light: { dmg: 50,  label: 'ЛТ',  icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/8d8f6982-6718-40f7-966b-840be3a8e9d4.jpg', name: 'Лёгкий танк' },
  heavy: { dmg: 100, label: 'ТТ',  icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/f9c80523-4acd-4f9b-8022-c71cec89061b.jpg', name: 'Тяжёлый танк' },
  arty:  { dmg: 50,  label: 'АРТ', icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/e47ec09b-76bf-4316-b8c9-554824f91c86.jpg', name: 'Артиллерия' },
};

// Дальность движения
export const MOVE_RANGE: Record<UnitType, number> = { heavy: 1, light: 2, arty: 1 };
// Дальность стрельбы
export const SHOOT_RANGE: Record<UnitType, number> = { heavy: 2, light: 2, arty: 4 };

let nextId = 1;

function inBounds(r: number, c: number) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

// ---------- Генерация поля ----------
// Поле 14 строк: ИИ — ряды 0,1; чистая полоса — ряд 2; горы — ряды 3..10; чистая — ряд 11; человек — ряды 12,13

function bfsReachable(mountains: boolean[][]): boolean[][] {
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  // Старт из любой свободной клетки ряда 2
  const queue: Cell[] = [];
  for (let c = 0; c < COLS; c++) {
    if (!mountains[2][c]) { visited[2][c] = true; queue.push({ r: 2, c }); }
  }
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dr, dc] of dirs) {
      const nr = cur.r + dr, nc = cur.c + dc;
      if (inBounds(nr, nc) && !visited[nr][nc] && !mountains[nr][nc]) {
        visited[nr][nc] = true;
        queue.push({ r: nr, c: nc });
      }
    }
  }
  return visited;
}

function generateMountains(): boolean[][] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const m: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));

    // Горы только в рядах 3..10
    const allowedRows: number[] = [];
    for (let r = 3; r <= 10; r++) allowedRows.push(r);

    const freeCells: Cell[] = [];
    for (const r of allowedRows) {
      for (let c = 0; c < COLS; c++) freeCells.push({ r, c });
    }

    // Плотность гор 30–35%
    const density = 0.30 + Math.random() * 0.05;
    const count = Math.round(freeCells.length * density);
    const shuffled = [...freeCells].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      m[shuffled[i].r][shuffled[i].c] = true;
    }

    // Проверяем проходимость: из ряда 2 должен быть путь в ряд 11
    const reach = bfsReachable(m);
    let ok = false;
    for (let c = 0; c < COLS; c++) {
      if (reach[11][c]) { ok = true; break; }
    }
    if (ok) return m;
  }
  return Array.from({ length: ROWS }, () => Array(COLS).fill(false));
}

function createUnit(owner: Owner, type: UnitType, r: number, c: number): Unit {
  return { id: nextId++, owner, type, hp: MAX_HP, r, c };
}

export function newGame(): GameState {
  nextId = 1;
  const mountains = generateMountains();
  const units: Unit[] = [];

  // Как в шахматах (8 столбцов):
  // Ряд пешек = ЛТ
  // Ряд фигур: ладья(0)=АРТ, конь(1)=ТТ, слон(2)=ТТ, ферзь(3)=ТТ, король(4)=ТТ, слон(5)=ТТ, конь(6)=ТТ, ладья(7)=АРТ
  const backRow1: UnitType[] = ['arty','heavy','heavy','heavy','heavy','heavy','heavy','arty'];

  // Человек снизу: ряд 13 — пешки (ЛТ), ряд 12 — фигуры
  for (let c = 0; c < COLS; c++) units.push(createUnit(1, 'light', 13, c));
  for (let c = 0; c < COLS; c++) units.push(createUnit(1, backRow1[c], 12, c));

  // ИИ сверху: ряд 0 — фигуры, ряд 1 — пешки (ЛТ)
  const backRow2: UnitType[] = ['arty','heavy','heavy','heavy','heavy','heavy','heavy','arty'];
  for (let c = 0; c < COLS; c++) units.push(createUnit(2, backRow2[c], 0, c));
  for (let c = 0; c < COLS; c++) units.push(createUnit(2, 'light', 1, c));

  return { mountains, units };
}

// ---------- Хелперы ----------

export function unitAt(units: Unit[], r: number, c: number): Unit | undefined {
  return units.find((u) => u.r === r && u.c === c && u.hp > 0);
}

const ROOK_DIRS  = [[1,0],[-1,0],[0,1],[0,-1]];
const QUEEN_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

// ---------- Возможные ходы ----------

export function getMoves(state: GameState, u: Unit): Cell[] {
  const { mountains, units } = state;
  const moves: Cell[] = [];
  const maxSteps = MOVE_RANGE[u.type];
  const dirs = u.type === 'heavy' ? ROOK_DIRS : QUEEN_DIRS;

  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= maxSteps; step++) {
      const nr = u.r + dr * step;
      const nc = u.c + dc * step;
      if (!inBounds(nr, nc) || mountains[nr][nc] || unitAt(units, nr, nc)) break;
      moves.push({ r: nr, c: nc });
    }
  }
  return moves;
}

// ---------- Возможные цели для стрельбы ----------

export function getTargets(state: GameState, u: Unit): Unit[] {
  const { mountains, units } = state;
  const targets: Unit[] = [];
  const range = SHOOT_RANGE[u.type];

  if (u.type === 'arty') {
    // Артиллерия стреляет через горы, только юниты блокируют
    for (const [dr, dc] of ROOK_DIRS) {
      for (let step = 1; step <= range; step++) {
        const nr = u.r + dr * step;
        const nc = u.c + dc * step;
        if (!inBounds(nr, nc)) break;
        // горы НЕ блокируют арту
        const target = unitAt(units, nr, nc);
        if (target) {
          if (target.owner !== u.owner) targets.push(target);
          break; // юнит (свой или враг) блокирует луч
        }
      }
    }
    return targets;
  }

  const dirs = u.type === 'heavy' ? ROOK_DIRS : QUEEN_DIRS;
  for (const [dr, dc] of dirs) {
    for (let step = 1; step <= range; step++) {
      const nr = u.r + dr * step;
      const nc = u.c + dc * step;
      if (!inBounds(nr, nc) || mountains[nr][nc]) break;
      const target = unitAt(units, nr, nc);
      if (target) {
        if (target.owner !== u.owner) targets.push(target);
        break;
      }
    }
  }
  return targets;
}

// ---------- Урон ----------

export function applyDamage(state: GameState, targetId: number, dmg: number): void {
  const t = state.units.find((u) => u.id === targetId);
  if (t) { t.hp = Math.max(0, t.hp - dmg); }
}

export function cleanupDead(state: GameState): void {
  state.units = state.units.filter((u) => u.hp > 0);
}

export function aliveUnits(state: GameState, owner: Owner): Unit[] {
  return state.units.filter((u) => u.owner === owner && u.hp > 0);
}

export function checkWinner(state: GameState): Owner | null {
  if (aliveUnits(state, 1).length === 0) return 2;
  if (aliveUnits(state, 2).length === 0) return 1;
  return null;
}

// ---------- ИИ ----------

function dist(a: Unit, b: Unit) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

export interface AIAction {
  unitId: number;
  move?: Cell;
  shootTargetId?: number;
}

export function computeAIMove(state: GameState): AIAction | null {
  const aiUnits = aliveUnits(state, 2);
  const enemies  = aliveUnits(state, 1);
  if (!aiUnits.length || !enemies.length) return null;

  // Приоритет: добивание > выстрел > наступление
  let bestShoot: { unit: Unit; target: Unit; score: number } | null = null;
  for (const u of aiUnits) {
    for (const t of getTargets(state, u)) {
      const dmg = UNIT_INFO[u.type].dmg;
      const score = dmg + (dmg >= t.hp ? 1000 : 0) - dist(u, t);
      if (!bestShoot || score > bestShoot.score) bestShoot = { unit: u, target: t, score };
    }
  }
  if (bestShoot) return { unitId: bestShoot.unit.id, shootTargetId: bestShoot.target.id };

  // Движение к ближайшему врагу
  let bestMove: { unit: Unit; cell: Cell; d: number } | null = null;
  for (const u of aiUnits) {
    const nearest = enemies.reduce((a, b) => dist(u, b) < dist(u, a) ? b : a);
    for (const cell of getMoves(state, u)) {
      const d = Math.abs(cell.r - nearest.r) + Math.abs(cell.c - nearest.c);
      if (!bestMove || d < bestMove.d) bestMove = { unit: u, cell, d };
    }
  }
  if (bestMove) return { unitId: bestMove.unit.id, move: bestMove.cell };

  return null;
}