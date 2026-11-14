/** ["10–13", "40"]: runs of three or more consecutive ids collapse into ranges; "50, 51" stays two items. */
export function idRuns(ids: number[]): string[] {
  const s = [...new Set(ids)].sort((a, b) => a - b),
    out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    if (j - i >= 2) {
      out.push(`${s[i]}–${s[j]}`);
      i = j;
    } else out.push(String(s[i]));
  }
  return out;
}
/** "10–13, 40" */
export const idList = (ids: number[]): string => idRuns(ids).join(", ");
