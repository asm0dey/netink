/**
 * Text width estimate (no font metrics available): 0.6 em per glyph, 0.65 em bold. Sized for the widest font in the
 * stack, DejaVu Sans: on the home labels it is at most 4 px short (in the box padding); Inter comes out narrower.
 */
export const textWidth = (s: string, px: number, bold: boolean): number => s.length * px * (bold ? 0.65 : 0.6);
