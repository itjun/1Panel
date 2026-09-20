/** 当前终端标签里的窗格树。row=左右，col=上下。ratio 是第一格占比。 */

export type PaneDir = "row" | "col";
export type PaneSide = "left" | "right" | "up" | "down";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
  host: string;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  dir: PaneDir;
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

const RATIO_MIN = 0.12;
const RATIO_MAX = 0.88;

export function clampRatio(n: number): number {
  if (n < RATIO_MIN) return RATIO_MIN;
  if (n > RATIO_MAX) return RATIO_MAX;
  return n;
}

export function orderedLeaves(node: PaneNode): string[] {
  if (node.kind === "leaf") return [node.id];
  return [...orderedLeaves(node.a), ...orderedLeaves(node.b)];
}

function firstLeaf(node: PaneNode): string {
  if (node.kind === "leaf") return node.id;
  return firstLeaf(node.a);
}

function lastLeaf(node: PaneNode): string {
  if (node.kind === "leaf") return node.id;
  return lastLeaf(node.b);
}

interface PathStep {
  node: PaneSplit;
  child: "a" | "b";
}

function pathTo(node: PaneNode, leafId: string, acc: PathStep[]): PathStep[] | null {
  if (node.kind === "leaf") {
    if (node.id === leafId) return acc;
    return null;
  }
  const viaA = pathTo(node.a, leafId, [...acc, { node, child: "a" }]);
  if (viaA) return viaA;
  return pathTo(node.b, leafId, [...acc, { node, child: "b" }]);
}

/** 在焦点窗格右侧或下方切开。新叶子连同一台主机。 */
export function splitLeaf(
  node: PaneNode,
  leafId: string,
  way: "right" | "down",
  newId: string,
  host: string
): PaneNode {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    return {
      kind: "split",
      id: `split-${newId}`,
      dir: way === "right" ? "row" : "col",
      ratio: 0.5,
      a: node,
      b: { kind: "leaf", id: newId, host },
    };
  }
  if (orderedLeaves(node.a).includes(leafId)) {
    return { ...node, a: splitLeaf(node.a, leafId, way, newId, host) };
  }
  return { ...node, b: splitLeaf(node.b, leafId, way, newId, host) };
}

export function findLeaf(node: PaneNode, leafId: string): PaneLeaf | null {
  if (node.kind === "leaf") {
    if (node.id === leafId) return node;
    return null;
  }
  return findLeaf(node.a, leafId) || findLeaf(node.b, leafId);
}

export function hostOf(node: PaneNode, leafId: string): string {
  return findLeaf(node, leafId)?.host || "";
}

/** 把已有窗格拖到目标窗格的某一侧。side 决定变成左右还是上下。 */
export function moveLeaf(root: PaneNode, leafId: string, targetId: string, side: PaneSide): PaneNode {
  if (!leafId || !targetId || leafId === targetId) return root;
  const moving = findLeaf(root, leafId);
  if (!moving) return root;
  if (!orderedLeaves(root).includes(targetId)) return root;
  const rest = removeLeaf(root, leafId);
  if (!rest) return root;
  if (!orderedLeaves(rest).includes(targetId)) return root;
  return placeBeside(rest, targetId, side, moving);
}

/** 在目标窗格某一侧放入一个新叶子（例如拖入另一台主机）。 */
export function placeBeside(node: PaneNode, targetId: string, side: PaneSide, leaf: PaneLeaf): PaneNode {
  const before = side === "left" || side === "up";
  const dir: PaneDir = side === "left" || side === "right" ? "row" : "col";
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    return {
      kind: "split",
      id: `split-${leaf.id}`,
      dir,
      ratio: 0.5,
      a: before ? leaf : node,
      b: before ? node : leaf,
    };
  }
  if (orderedLeaves(node.a).includes(targetId)) {
    return { ...node, a: placeBeside(node.a, targetId, side, leaf) };
  }
  return { ...node, b: placeBeside(node.b, targetId, side, leaf) };
}

/** 去掉一个叶子。只剩它自己时返回 null。 */
export function removeLeaf(node: PaneNode, leafId: string): PaneNode | null {
  if (node.kind === "leaf") {
    if (node.id === leafId) return null;
    return node;
  }
  const aHas = orderedLeaves(node.a).includes(leafId);
  if (aHas) {
    const next = removeLeaf(node.a, leafId);
    if (!next) return node.b;
    return { ...node, a: next };
  }
  const next = removeLeaf(node.b, leafId);
  if (!next) return node.a;
  return { ...node, b: next };
}

export function neighborId(root: PaneNode, leafId: string, side: PaneSide): string | null {
  const path = pathTo(root, leafId, []);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (side === "right" && step.node.dir === "row" && step.child === "a") {
      return firstLeaf(step.node.b);
    }
    if (side === "left" && step.node.dir === "row" && step.child === "b") {
      return lastLeaf(step.node.a);
    }
    if (side === "down" && step.node.dir === "col" && step.child === "a") {
      return firstLeaf(step.node.b);
    }
    if (side === "up" && step.node.dir === "col" && step.child === "b") {
      return lastLeaf(step.node.a);
    }
  }
  return null;
}

export interface ResizeHit {
  splitId: string;
  /** 加到 ratio 上的方向：正数让第一格变大 */
  sign: 1 | -1;
}

/** 让焦点窗格朝该方向变大；没有可推的分隔条时返回 null */
export function resizeHit(root: PaneNode, leafId: string, side: PaneSide): ResizeHit | null {
  const path = pathTo(root, leafId, []);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (side === "right" && step.node.dir === "row" && step.child === "a") {
      return { splitId: step.node.id, sign: 1 };
    }
    if (side === "left" && step.node.dir === "row" && step.child === "b") {
      return { splitId: step.node.id, sign: -1 };
    }
    if (side === "down" && step.node.dir === "col" && step.child === "a") {
      return { splitId: step.node.id, sign: 1 };
    }
    if (side === "up" && step.node.dir === "col" && step.child === "b") {
      return { splitId: step.node.id, sign: -1 };
    }
  }
  return null;
}

export function splitRatioOf(node: PaneNode, splitId: string): number | null {
  if (node.kind === "leaf") return null;
  if (node.id === splitId) return node.ratio;
  const inA = splitRatioOf(node.a, splitId);
  if (inA != null) return inA;
  return splitRatioOf(node.b, splitId);
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) {
    return { ...node, ratio: clampRatio(ratio) };
  }
  return {
    ...node,
    a: setRatio(node.a, splitId, ratio),
    b: setRatio(node.b, splitId, ratio),
  };
}

export function equalizeRatios(node: PaneNode): PaneNode {
  if (node.kind === "leaf") return node;
  return {
    ...node,
    ratio: 0.5,
    a: equalizeRatios(node.a),
    b: equalizeRatios(node.b),
  };
}

function leafCount(node: PaneNode): number {
  if (node.kind === "leaf") return 1;
  return leafCount(node.a) + leafCount(node.b);
}

let gridSeq = 0;

/** 同方向把若干子树串起来，ratio 按各侧叶子数分，保证每个叶子最终等大。 */
function stackDir(items: PaneNode[], dir: PaneDir): PaneNode {
  let node = items[0];
  let left = leafCount(node);
  for (let i = 1; i < items.length; i++) {
    const count = leafCount(items[i]);
    left += count;
    node = {
      kind: "split",
      id: `split-grid-${(gridSeq += 1)}`,
      dir,
      ratio: clampRatio((left - count) / left),
      a: node,
      b: items[i],
    };
  }
  return node;
}

/** 把叶子重排成近似正方形的网格：cols 列，列内上下均分，列间左右均分。 */
export function gridTree(leaves: PaneLeaf[], cols: number): PaneNode {
  const n = leaves.length;
  if (n === 0) throw new Error("gridTree: no leaves");
  let width = Math.min(Math.max(cols, 1), n);
  const base = Math.floor(n / width);
  const rem = n % width;
  const columns: PaneNode[] = [];
  let idx = 0;
  for (let c = 0; c < width && idx < n; c++) {
    const count = c < rem ? base + 1 : base;
    if (count <= 0) continue;
    columns.push(stackDir(leaves.slice(idx, idx + count), "col"));
    idx += count;
  }
  if (columns.length === 1) return columns[0];
  return stackDir(columns, "row");
}
