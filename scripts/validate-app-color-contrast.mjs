import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(repoRoot, 'src', 'index.css');
const css = fs.readFileSync(cssPath, 'utf8');
const trainingPath = path.join(repoRoot, 'src', 'pages', 'portal', 'Training.tsx');
const partnershipsPath = path.join(repoRoot, 'src', 'pages', 'admin', 'Partnerships.tsx');
const training = fs.readFileSync(trainingPath, 'utf8');
const partnerships = fs.readFileSync(partnershipsPath, 'utf8');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const selectorBlock = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  assert(match, `Missing ${selector} token block in ${path.relative(repoRoot, cssPath)}.`);
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

const composite = (foreground, background, alpha) =>
  foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha));

const rootBlock = selectorBlock(':root');
const appBlock = selectorBlock('.app-surface');
const darkBlock = selectorBlock('.dark');
const darkAppMatch = css.match(
  /\.dark\.app-surface,\s*\.dark \.app-surface\s*\{([\s\S]*?)\n\s*\}/,
);
assert(darkAppMatch, 'Missing dark app token block.');
const darkAppBlock = darkAppMatch[1];
const background = hslToRgb(parseHsl(tokenValue(rootBlock, 'background'), '--background'));
const card = hslToRgb(parseHsl(tokenValue(rootBlock, 'card'), '--card'));
const primary = hslToRgb(parseHsl(tokenValue(appBlock, 'primary'), '--primary'));
const primaryForeground = hslToRgb(
  parseHsl(tokenValue(appBlock, 'primary-foreground'), '--primary-foreground'),
);
const ring = hslToRgb(parseHsl(tokenValue(appBlock, 'ring'), '--ring'));
const coralDark = hslToRgb(parseHsl(tokenValue(appBlock, 'coral-dark'), '--coral-dark'));
const primaryTint = composite(primary, background, 0.1);
const primaryAtEightyPercent = composite(primary, background, 0.8);

const darkBackground = hslToRgb(
  parseHsl(tokenValue(darkBlock, 'background'), 'dark --background'),
);
const darkCard = hslToRgb(parseHsl(tokenValue(darkBlock, 'card'), 'dark --card'));
const darkPrimary = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'primary'), 'dark --primary'),
);
const darkPrimaryForeground = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'primary-foreground'), 'dark --primary-foreground'),
);
const darkRing = hslToRgb(parseHsl(tokenValue(darkAppBlock, 'ring'), 'dark --ring'));
const darkCoralDark = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'coral-dark'), 'dark --coral-dark'),
);
const darkPrimaryTint = composite(darkPrimary, darkBackground, 0.1);
const darkPrimaryAtEightyPercent = composite(darkPrimary, darkBackground, 0.8);

const checks = [
  {
    label: 'filled primary action text',
    ratio: contrastRatio(primary, primaryForeground),
    minimum: 4.5,
  },
  {
    label: 'primary link text on app background',
    ratio: contrastRatio(primary, background),
    minimum: 4.5,
  },
  {
    label: 'primary text on 10% primary tint',
    ratio: contrastRatio(primary, primaryTint),
    minimum: 4.5,
  },
  {
    label: '80% primary hover text on app background',
    ratio: contrastRatio(primaryAtEightyPercent, background),
    minimum: 4.5,
  },
  {
    label: 'text on 80% primary hover fill',
    ratio: contrastRatio(primaryAtEightyPercent, primaryForeground),
    minimum: 4.5,
  },
  {
    label: 'focus ring on app background',
    ratio: contrastRatio(ring, background),
    minimum: 3,
  },
  {
    label: 'focus ring on app card',
    ratio: contrastRatio(ring, card),
    minimum: 3,
  },
  {
    label: 'selected-state border on app background',
    ratio: contrastRatio(primary, background),
    minimum: 3,
  },
  {
    label: 'primary button hover fill',
    ratio: contrastRatio(coralDark, primaryForeground),
    minimum: 4.5,
  },
  {
    label: 'dark filled primary action text',
    ratio: contrastRatio(darkPrimary, darkPrimaryForeground),
    minimum: 4.5,
  },
  {
    label: 'dark primary link text on app background',
    ratio: contrastRatio(darkPrimary, darkBackground),
    minimum: 4.5,
  },
  {
    label: 'dark primary text on 10% primary tint',
    ratio: contrastRatio(darkPrimary, darkPrimaryTint),
    minimum: 4.5,
  },
  {
    label: 'dark 80% primary hover text on app background',
    ratio: contrastRatio(darkPrimaryAtEightyPercent, darkBackground),
    minimum: 4.5,
  },
  {
    label: 'dark text on 80% primary hover fill',
    ratio: contrastRatio(darkPrimaryAtEightyPercent, darkPrimaryForeground),
    minimum: 4.5,
  },
  {
    label: 'dark focus ring on app background',
    ratio: contrastRatio(darkRing, darkBackground),
    minimum: 3,
  },
  {
    label: 'dark focus ring on app card',
    ratio: contrastRatio(darkRing, darkCard),
    minimum: 3,
  },
  {
    label: 'dark selected-state border on app background',
    ratio: contrastRatio(darkPrimary, darkBackground),
    minimum: 3,
  },
  {
    label: 'dark primary button hover fill',
    ratio: contrastRatio(darkCoralDark, darkPrimaryForeground),
    minimum: 4.5,
  },
];

for (const check of checks) {
  assert(
    check.ratio >= check.minimum,
    `${check.label} contrast ${check.ratio.toFixed(2)}:1 is below ${check.minimum}:1.`,
  );
  console.log(`${check.label}: ${check.ratio.toFixed(2)}:1`);
}

assert(
  tokenValue(rootBlock, 'primary') === '345 72% 68%',
  'Public-site --primary changed; app palette must remain route-scoped.',
);
assert(
  tokenValue(rootBlock, 'primary') !== tokenValue(appBlock, 'primary'),
  'App and public primary tokens must remain independently scoped.',
);
assert(
  training.includes("? 'border-primary bg-primary/5 shadow-sm'"),
  'Selected Training tracks need a full-strength primary border.',
);
assert(
  partnerships.includes("? 'border-primary bg-primary/10'"),
  'The active mobile partnership step needs a full-strength primary border.',
);

console.log('Authenticated app color contrast validation passed.');
process.exit(0);
