/** Text width estimate (no font metrics available): average glyph advance ≈ 0.55 em, 0.6 em bold. */
export const textWidth = (s: string, px: number, bold: boolean): number => s.length * px * (bold ? 0.6 : 0.55);
