import { palettes, statusTokens } from '../src/theme/tokens';

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(['light', 'dark'] as const)('%s theme meets WCAG AA', (scheme) => {
  const c = palettes[scheme];

  it.each([
    ['text on bg', c.text, c.bg],
    ['text on surface', c.text, c.surface],
    ['muted text on bg', c.textMuted, c.bg],
    ['muted text on surface', c.textMuted, c.surface],
    ['primary on surface', c.primary, c.surface],
    ['button label on primary', c.onPrimary, c.primary],
    ['button label on danger', c.onDanger, c.danger],
    ['danger text on surface', c.danger, c.surface],
  ])('%s >= 4.5', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(statusTokens[scheme]))('status %s word on its badge >= 4.5', (_status, t) => {
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('field borders stand out from the surface', () => {
    expect(contrast(c.border, c.surface)).toBeGreaterThanOrEqual(1.5);
  });
});
