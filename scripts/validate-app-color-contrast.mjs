import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(repoRoot, 'src', 'index.css');
const css = fs.readFileSync(cssPath, 'utf8');
const trainingPath = path.join(repoRoot, 'src', 'pages', 'portal', 'Training.tsx');
const partnershipsPath = path.join(repoRoot, 'src', 'pages', 'admin', 'Partnerships.tsx');
const timePath = path.join(repoRoot, 'src', 'pages', 'portal', 'Time.tsx');
const timeReviewPath = path.join(repoRoot, 'src', 'pages', 'portal', 'TimeReview.tsx');
const buttonVariantsPath = path.join(
  repoRoot,
  'src',
  'components',
  'ui',
  'button-variants.ts',
);
const training = fs.readFileSync(trainingPath, 'utf8');
const partnerships = fs.readFileSync(partnershipsPath, 'utf8');
const time = fs.readFileSync(timePath, 'utf8');
const timeReview = fs.readFileSync(timeReviewPath, 'utf8');
const buttonVariants = fs.readFileSync(buttonVariantsPath, 'utf8');
const reports = fs.readFileSync(
  path.join(repoRoot, 'src', 'pages', 'portal', 'Reports.tsx'),
  'utf8',
);

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
const foreground = hslToRgb(parseHsl(tokenValue(rootBlock, 'foreground'), '--foreground'));
const muted = hslToRgb(parseHsl(tokenValue(rootBlock, 'muted'), '--muted'));
const amber = hslToRgb(parseHsl(tokenValue(rootBlock, 'amber'), '--amber'));
const sage = hslToRgb(parseHsl(tokenValue(rootBlock, 'sage'), '--sage'));
const primary = hslToRgb(parseHsl(tokenValue(appBlock, 'primary'), '--primary'));
const ring = hslToRgb(parseHsl(tokenValue(appBlock, 'ring'), '--ring'));
const action = hslToRgb(parseHsl(tokenValue(appBlock, 'action'), '--action'));
const actionForeground = hslToRgb(
  parseHsl(tokenValue(appBlock, 'action-foreground'), '--action-foreground'),
);
const actionHover = hslToRgb(
  parseHsl(tokenValue(appBlock, 'action-hover'), '--action-hover'),
);
const actionActive = hslToRgb(
  parseHsl(tokenValue(appBlock, 'action-active'), '--action-active'),
);
const primaryTint = composite(primary, background, 0.1);
const primaryAtEightyPercent = composite(primary, background, 0.8);

const darkBackground = hslToRgb(
  parseHsl(tokenValue(darkBlock, 'background'), 'dark --background'),
);
const darkCard = hslToRgb(parseHsl(tokenValue(darkBlock, 'card'), 'dark --card'));
const darkForeground = hslToRgb(
  parseHsl(tokenValue(darkBlock, 'foreground'), 'dark --foreground'),
);
const darkMuted = hslToRgb(parseHsl(tokenValue(darkBlock, 'muted'), 'dark --muted'));
const darkPrimary = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'primary'), 'dark --primary'),
);
const darkRing = hslToRgb(parseHsl(tokenValue(darkAppBlock, 'ring'), 'dark --ring'));
const darkAction = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'action'), 'dark --action'),
);
const darkActionForeground = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'action-foreground'), 'dark --action-foreground'),
);
const darkActionHover = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'action-hover'), 'dark --action-hover'),
);
const darkActionActive = hslToRgb(
  parseHsl(tokenValue(darkAppBlock, 'action-active'), 'dark --action-active'),
);
const darkPrimaryTint = composite(darkPrimary, darkBackground, 0.1);
const darkPrimaryAtEightyPercent = composite(darkPrimary, darkBackground, 0.8);
const approvedBadgeTint = composite(sage, background, 0.1);
const correctionBadgeTint = composite(amber, background, 0.1);
const settledBadgeTint = composite(muted, background, 0.6);
const darkApprovedBadgeTint = composite(sage, darkBackground, 0.1);
const darkCorrectionBadgeTint = composite(amber, darkBackground, 0.1);
const darkSettledBadgeTint = composite(darkMuted, darkBackground, 0.6);

const checks = [
  {
    label: 'filled primary action text',
    ratio: contrastRatio(action, actionForeground),
    minimum: 4.5,
  },
  {
    label: 'filled primary action hover text',
    ratio: contrastRatio(actionHover, actionForeground),
    minimum: 4.5,
  },
  {
    label: 'filled primary action active text',
    ratio: contrastRatio(actionActive, actionForeground),
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
    label: 'dark filled primary action text',
    ratio: contrastRatio(darkAction, darkActionForeground),
    minimum: 4.5,
  },
  {
    label: 'dark filled primary action hover text',
    ratio: contrastRatio(darkActionHover, darkActionForeground),
    minimum: 4.5,
  },
  {
    label: 'dark filled primary action active text',
    ratio: contrastRatio(darkActionActive, darkActionForeground),
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
    label: '12px approved badge text',
    ratio: contrastRatio(foreground, approvedBadgeTint),
    minimum: 4.5,
  },
  {
    label: '12px correction badge text',
    ratio: contrastRatio(foreground, correctionBadgeTint),
    minimum: 4.5,
  },
  {
    label: '12px included, paid, and locked badge text',
    ratio: contrastRatio(foreground, settledBadgeTint),
    minimum: 4.5,
  },
  {
    label: 'dark 12px approved badge text',
    ratio: contrastRatio(darkForeground, darkApprovedBadgeTint),
    minimum: 4.5,
  },
  {
    label: 'dark 12px correction badge text',
    ratio: contrastRatio(darkForeground, darkCorrectionBadgeTint),
    minimum: 4.5,
  },
  {
    label: 'dark 12px included, paid, and locked badge text',
    ratio: contrastRatio(darkForeground, darkSettledBadgeTint),
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
  tokenValue(rootBlock, 'action') === tokenValue(rootBlock, 'primary') &&
    tokenValue(rootBlock, 'action-foreground') === tokenValue(rootBlock, 'primary-foreground'),
  'Public action tokens must preserve the existing public primary treatment.',
);
assert(
  tokenValue(rootBlock, 'action-shadow-hover') ===
    '0 6px 20px -3px hsl(16 85% 55% / 0.35)',
  'Public buttons must preserve their existing hover shadow.',
);
assert(
  tokenValue(appBlock, 'action') === '345 72% 68%' &&
    tokenValue(appBlock, 'action-foreground') === '220 20% 14%' &&
    tokenValue(appBlock, 'action-hover') === '345 72% 64%' &&
    tokenValue(appBlock, 'action-active') === '345 72% 62%',
  'Authenticated light actions must use the approved bright Bloomjoy semantic treatment.',
);
assert(
  tokenValue(appBlock, 'primary') === '335 65% 40%' &&
    tokenValue(appBlock, 'ring') === '335 65% 40%',
  'Authenticated links and focus rings must retain the approved deeper interaction ink.',
);
assert(
  buttonVariants.includes(
    'bg-action text-action-foreground shadow-action hover:bg-action-hover',
  ) && buttonVariants.includes('active:bg-action-active'),
  'Shared default and hero buttons must use the semantic action treatment.',
);
assert(
  !buttonVariants.includes('hsl(16_85%_55%'),
  'Shared buttons must not reintroduce the hard-coded orange hover shadow.',
);
assert(
  reports.includes('data-portal-report-export="operator-pdf"') &&
    reports.includes('data-portal-report-export="partner"'),
  'Reporting exports must expose shared-action UAT contracts.',
);
assert(
  training.includes("? 'border-primary bg-primary/5 shadow-sm'"),
  'Selected Training tracks need a full-strength primary border.',
);
assert(
  partnerships.includes("? 'border-primary bg-primary/10'"),
  'The active mobile partnership step needs a full-strength primary border.',
);
for (const [source, label] of [
  [time, 'Technician Time'],
  [timeReview, 'Time Review'],
]) {
  assert(
    source.includes('border-sage/40 bg-sage/10 text-foreground'),
    `${label} approved badges need theme-safe normal-text contrast classes.`,
  );
  assert(
    source.includes('border-amber/40 bg-amber/10 text-foreground'),
    `${label} correction badges need theme-safe normal-text contrast classes.`,
  );
  assert(
    source.includes('border-border bg-muted/60 text-foreground'),
    `${label} included, paid, and locked badges need theme-safe normal-text contrast classes.`,
  );
}

console.log('Authenticated app color contrast validation passed.');
process.exit(0);
