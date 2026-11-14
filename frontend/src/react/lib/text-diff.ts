export type TextDiffLine = {
  kind: "same" | "removed" | "added";
  text: string;
  beforeLine?: number;
  afterLine?: number;
};

/** 保留换行符参与比较，避免把空文件、末尾换行和 CRLF 的变化漏掉。 */
export function diffTextLines(before: string, after: string): TextDiffLine[] {
  const left = before.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
  const right = after.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
  const rows: TextDiffLine[] = [];
  let i = 0;
  let j = 0;
  function append(kind: TextDiffLine["kind"]) {
    rows.push({
      kind,
      text: kind === "added" ? right[j] : left[i],
      beforeLine: kind === "added" ? undefined : i + 1,
      afterLine: kind === "removed" ? undefined : j + 1,
    });
    if (kind !== "added") i++;
    if (kind !== "removed") j++;
  }
  while (i < left.length && j < right.length && left[i] === right[j]) append("same");
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > i && rightEnd > j && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const height = leftEnd - i;
  const width = rightEnd - j;
  // 限制比较矩阵，极大的改写区直接展示整段删除/新增，避免阻塞阅读页。
  if ((height + 1) * (width + 1) > 1_000_000) {
    while (i < leftEnd) append("removed");
    while (j < rightEnd) append("added");
  } else {
    const startI = i;
    const startJ = j;
    const stride = width + 1;
    const lengths = new Uint32Array((height + 1) * stride);
    for (let a = height - 1; a >= 0; a--) {
      for (let b = width - 1; b >= 0; b--) {
        lengths[a * stride + b] = left[startI + a] === right[startJ + b]
          ? lengths[(a + 1) * stride + b + 1] + 1
          : Math.max(lengths[(a + 1) * stride + b], lengths[a * stride + b + 1]);
      }
    }
    while (i < leftEnd && j < rightEnd) {
      if (left[i] === right[j]) append("same");
      else if (lengths[(i - startI + 1) * stride + j - startJ] >= lengths[(i - startI) * stride + j - startJ + 1]) append("removed");
      else append("added");
    }
    while (i < leftEnd) append("removed");
    while (j < rightEnd) append("added");
  }
  while (i < left.length && j < right.length) append("same");
  return rows;
}

/** 差异前后各保留三行上下文，连续的相同行用数量代替。 */
export function diffContext(rows: TextDiffLine[]): (TextDiffLine | number)[] {
  const visible = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    for (let i = Math.max(0, index - 3); i <= Math.min(rows.length - 1, index + 3); i++) visible.add(i);
  });
  const result: (TextDiffLine | number)[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (!visible.has(index)) { skipped++; return; }
    if (skipped) { result.push(skipped); skipped = 0; }
    result.push(row);
  });
  if (skipped) result.push(skipped);
  return result;
}
