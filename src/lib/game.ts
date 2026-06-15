export const SIZE = 9;

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
  light: { dmg: 50, label: 'ЛТ', icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/8d8f6982-6718-40f7-966b-840be3a8e9d4.jpg', name: 'Лёгкий танк' },
  heavy: { dmg: 100, label: 'ТТ', icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/f9c80523-4acd-4f9b-8022-c71cec89061b.jpg', name: 'Тяжёлый танк' },
  arty: { dmg: 25, label: 'АРТ', icon: 'https://cdn.poehali.dev/projects/1a799503-e7c0-418c-a1a7-bb3c7dce8684/files/e47ec09b-76bf-4316-b8c9-554824f91c86.jpg', name: 'Артиллерия' },
};

let nextId = 1;

function inBounds(r: number, c: number) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// ---------- Генерация поля ----------

function bfsReachable(mountains: boolean[][], start: Cell): boolean[][] {
  const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const queue: Cell[] = [start];
  visited[start.r][start.c] = true;
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dr, dc] of dirs) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (inBounds(nr, nc) && !visited[nr][nc] && !mountains[nr][nc]) {
        visited[nr][nc] = true;
        queue.push({ r: nr, c: nc });
      }
    }
  }
  return visited;
}

function generateMountains(): boolean[][] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    // запрещённые ряды: 0,1 (ИИ), 2 (полоса), 6 (полоса), 7,8 (человек). Свободны для гор: 3,4,5
    const allowedRows = [3, 4, 5];
    const freeCells: Cell[] = [];
    for (const r of allowedRows) {
      for (let c = 0; c < SIZE; c++) freeCells.push({ r, c });
    }
    const density = 0.15 + Math.random() * 0.05;
    const count = Math.round(freeCells.length * density);
    const shuffled = [...freeCells].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      m[shuffled[i].r][shuffled[i].c] = true;
    }
    // Проверка: из центра достижимы обе чистые полосы (ряд 2 сверху и ряд 6 снизу)
    const reach = bfsReachable(m, { r: 4, c: 4 });
    let topConnected = false;
    let botConnected = false;
    for (let c = 0; c < SIZE; c++) {
      if (reach[2][c]) topConnected = true;
      if (reach[6][c]) botConnected = true;
    }
    if (topConnected && botConnected) return m;
  }
  // fallback — без гор
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
}

function createUnit(owner: Owner, type: UnitType, r: number, c: number): Unit {
  return { id: nextId++, owner, type, hp: MAX_HP, r, c };
}

export function newGame(): GameState {
  nextId = 1;
  const mountains = generateMountains();
  const units: Unit[] = [];

  // Игрок 1 (человек, снизу): ряд 8 — все ЛТ
  for (let c = 0; c < SIZE; c++) units.push(createUnit(1, 'light', 8, c));
  // ряд 7: края — ТТ, центр (3,4,5) — АРТ
  units.push(createUnit(1, 'heavy', 7, 0));
  units.push(createUnit(1, 'heavy', 7, SIZE - 1));
  units.push(createUnit(1, 'arty', 7, 3));
  units.push(createUnit(1, 'arty', 7, 4));
  units.push(createUnit(1, 'arty', 7, 5));

  // Игрок 2 (ИИ, сверху): ряд 0 — все ЛТ
  for (let c = 0; c < SIZE; c++) units.push(createUnit(2, 'light', 0, c));
  units.push(createUnit(2, 'heavy', 1, 0));
  units.push(createUnit(2, 'heavy', 1, SIZE - 1));
  units.push(createUnit(2, 'arty', 1, 3));
  units.push(createUnit(2, 'arty', 1, 4));
  units.push(createUnit(2, 'arty', 1, 5));

  return { mountains, units };
}

// ---------- Хелперы ----------

export function unitAt(units: Unit[], r: number, c: number): Unit | undefined {
  return units.find((u) => u.r === r && u.c === c && u.hp > 0);
}

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Дальность движения: ТТ=1, ЛТ=2, АРТ=1
export const MOVE_RANGE: Record<UnitType, number> = { heavy: 1, light: 2, arty: 1 };
// Дальность стрельбы: 4 клетки для всех танков, 5 для АРТ
export const SHOOT_RANGE: Record<UnitType, number> = { heavy: 4, light: 4, arty: 5 };

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
    // артиллерия: горизонталь/вертикаль, свои не блокируют
    for (const [dr, dc] of ROOK_DIRS) {
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

  // ЛТ — все 8 направлений, ТТ — 4 прямых
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

// ---------- Применение урона ----------

export function applyDamage(state: GameState, targetId: number, dmg: number): void {
  const t = state.units.find((u) => u.id === targetId);
  if (t) {
    t.hp -= dmg;
    if (t.hp <= 0) t.hp = 0;
  }
}

export function cleanupDead(state: GameState): void {
  state.units = state.units.filter((u) => u.hp > 0);
}

export function aliveUnits(state: GameState, owner: Owner): Unit[] {
  return state.units.filter((u) => u.owner === owner && u.hp > 0);
}

export function checkWinner(state: GameState): Owner | null {
  const p1 = aliveUnits(state, 1).length;
  const p2 = aliveUnits(state, 2).length;
  if (p1 === 0) return 2;
  if (p2 === 0) return 1;
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
  const enemies = aliveUnits(state, 1);
  if (aiUnits.length === 0 || enemies.length === 0) return null;

  // 1. Предпочитаем стрельбу — ищем юнит, который может выстрелить, выбираем макс урон/добитие
  let bestShoot: { unit: Unit; target: Unit; score: number } | null = null;
  for (const u of aiUnits) {
    const targets = getTargets(state, u);
    for (const t of targets) {
      const dmg = UNIT_INFO[u.type].dmg;
      let score = dmg;
      if (dmg >= t.hp) score += 1000; // добивание в приоритете
      score -= dist(u, t); // ближе — лучше
      if (!bestShoot || score > bestShoot.score) {
        bestShoot = { unit: u, target: t, score };
      }
    }
  }
  if (bestShoot) {
    return { unitId: bestShoot.unit.id, shootTargetId: bestShoot.target.id };
  }

  // 2. Иначе двигаемся ближайшим юнитом к ближайшему врагу
  let bestMove: { unit: Unit; cell: Cell; d: number } | null = null;
  for (const u of aiUnits) {
    const moves = getMoves(state, u);
    if (moves.length === 0) continue;
    // ближайший враг
    let nearest = enemies[0];
    let nd = dist(u, nearest);
    for (const e of enemies) {
      const d = dist(u, e);
      if (d < nd) { nd = d; nearest = e; }
    }
    // выбираем клетку, минимизирующую расстояние до врага
    for (const cell of moves) {
      const d = Math.abs(cell.r - nearest.r) + Math.abs(cell.c - nearest.c);
      if (!bestMove || d < bestMove.d) {
        bestMove = { unit: u, cell, d };
      }
    }
  }
  if (bestMove) {
    // после движения — проверим, можно ли выстрелить с новой позиции
    return { unitId: bestMove.unit.id, move: bestMove.cell };
  }

  return null;
}