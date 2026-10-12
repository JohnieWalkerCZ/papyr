export type ConflictDiffRow = { kind: "same" | "added" | "removed"; text: string };

export function compareTextVersions(local: string, server: string): ConflictDiffRow[] | null {
  const left = local.split("\n");
  const right = server.split("\n");
  if (left.length > 500 || right.length > 500) return null;
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i][j] = left[i] === right[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const rows: ConflictDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({ kind: "same", text: left[i++] });
      j++;
    } else if (i < left.length && (j === right.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
      rows.push({ kind: "removed", text: left[i++] });
    } else {
      rows.push({ kind: "added", text: right[j++] });
    }
  }
  return rows;
}
