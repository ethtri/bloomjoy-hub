import fs from 'node:fs';
import assert from 'node:assert/strict';
const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const selectorBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  assert(match, `Missing ${selector} token block in ${'src/index.css'}.`);
  return match[1];
};

const tokenValue = (block, token) => {
  const match = block.match(new RegExp(`--${token}:\\s*([^;]+);`));
  assert(match, `Missing --${token} in the app token block.`);
  return match[1].trim();
};

const parseHsl = (value, label) => {
  const parts = value.split(/\s+/).map((part) => Number(part.replace('%', '')));
  assert(
    parts.length === 3 && parts.every(Number.isFinite),
    `${label} must be a three-part HSL token, received "${value}".`,
  );
  return parts;
};

const hslToRgb = ([hue, saturationPercent, lightnessPercent]) => {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = ((hue % 360) + 360) % 360 / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;

  let channels;
  if (huePrime < 1) channels = [chroma, secondary, 0];
  else if (huePrime < 2) channels = [secondary, chroma, 0];
  else if (huePrime < 3) channels = [0, chroma, secondary];
  else if (huePrime < 4) channels = [0, secondary, chroma];
  else if (huePrime < 5) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  return channels.map((channel) => channel + match);
};

const relativeLuminance = (rgb) =>
  rgb
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    );

const contrastRatio = (first, second) => {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
};

const rootBlock = selectorBlock(':root');
const darkBlock = selectorBlock('.dark');
const background = hslToRgb(parseHsl(tokenValue(rootBlock, 'background'), 'background'));
const darkBackground = hslToRgb(parseHsl(tokenValue(darkBlock, 'background'), 'background'));
// Public pages use independent tokens, including controls portalled to body.
for (const [selector, surfaceBackground] of [
  ['.marketing-surface', background],
  ['.dark .marketing-surface', darkBackground],
]) {
  const block = selectorBlock(selector);
  const color = (token) => hslToRgb(parseHsl(tokenValue(block, token), token));
  for (const token of ['action', 'action-hover', 'action-active']) {
    const ratio = contrastRatio(color(token), color('action-foreground'));
    assert(ratio >= 4.5, `${selector} ${token} text contrast is ${ratio.toFixed(2)}:1.`);
    console.log(`${selector} ${token}: ${ratio.toFixed(2)}:1`);
  }
  const primaryRatio = contrastRatio(color('primary'), surfaceBackground);
  assert(primaryRatio >= 4.5, `${selector} links need normal-text contrast.`);
  assert(contrastRatio(color('primary'), color('primary-foreground')) >= 4.5,
    `${selector} primary badges need normal-text contrast.`);
  assert(contrastRatio(color('muted-foreground'), surfaceBackground) >= 4.5,
    `${selector} secondary text needs normal-text contrast.`);
}

console.log('Public action and text contrast passed.');
