// One-off WCAG contrast verification for the theme tokens (NFR 2.3).
// Computes the contrast ratio for each foreground/background pair used by the
// layout shell and asserts >= 4.5:1 for normal text.
function lum(hex) {
  const v = hex.replace('#', '');
  const n = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = n.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function ratio(fg, bg) {
  const a = lum(fg);
  const b = lum(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const pairs = [
  // [label, foreground, background]
  ['light: body text on surface', '#1a1a1a', '#ffffff'],
  ['light: muted on surface', '#6b7280', '#ffffff'],
  ['light: vocabulary accent on surface', '#dc2626', '#ffffff'],
  ['light: accretion accent on surface', '#7c3aed', '#ffffff'],
  ['light: speaking accent on surface', '#15803d', '#ffffff'],
  ['light: writing accent on surface', '#2563eb', '#ffffff'],
  ['light: sidebar fg on sidebar', '#f5f5f5', '#1a1a1a'],
  ['dark: body text on surface', '#f5f5f5', '#0f0f0f'],
  ['dark: muted on surface', '#9ca3af', '#0f0f0f'],
  ['dark: sidebar fg on sidebar(black)', '#f5f5f5', '#000000'],
  ['dark: vocabulary accent on sidebar', '#f87171', '#000000'],
  ['dark: accretion accent on sidebar', '#c084fc', '#000000'],
  ['dark: speaking accent on sidebar', '#4ade80', '#000000'],
  ['dark: writing accent on sidebar', '#60a5fa', '#000000'],
  ['dark: writing accent on surface', '#60a5fa', '#0f0f0f'],
];

let allPass = true;
for (const [label, fg, bg] of pairs) {
  const r = ratio(fg, bg);
  const pass = r >= 4.5;
  if (!pass) allPass = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1  ${label}`);
}
console.log(allPass ? '\nAll pairs >= 4.5:1' : '\nSOME PAIRS FAIL');
process.exit(allPass ? 0 : 1);
