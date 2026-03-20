import type { TrainingContent, TrainingTrack } from '@/lib/trainingTypes';
import {
  alarmAndPowerTimerDocument,
  cleaningChecklistDocument,
  consumablesGuideDocument,
  maintenanceReferenceDocument,
  moduleFunctionCheckDocument,
  pricingAndPaymentsDocument,
  softwareSetupQuickstartDocument,
} from '@/data/trainingManuals';

const placeholderEmbed = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .frame { height: 100vh; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #475569; }
      .card { border: 1px dashed #cbd5e1; padding: 24px; border-radius: 16px; background: #ffffff; max-width: 420px; text-align: center; }
      .title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
      .subtitle { font-size: 13px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="card">
        <div class="title">${title}</div>
        <div class="subtitle">Embedded training content placeholder. Replace with real video or document embed when ready.</div>
      </div>
    </div>
  </body>
</html>`;

export const trainingContent: TrainingContent[] = [
  {
    id: 'software-setup-quickstart',
    title: 'Software Setup Quickstart',
    description:
      'Use this guide when you need fast admin access, Wi-Fi, time zone, and first-login setup.',
    duration: '9 min',
    tags: [
      'Audience: Operator',
      'Task: Start Here',
      'Task: Software & Payments',
      'Format: Guide',
      'Admin',
      'Wi-Fi',
      'Time zone',
    ],
    level: 'Beginner',
    summary:
      'Covers the first software setup actions that unblock pricing, payments, and daily automation.',
    learningPoints: [
      'Enter the admin flow without getting stuck in the hidden Android menu sequence.',
      'Set Wi-Fi, local time, and time zone correctly before changing machine settings.',
      'Return the machine to the normal staff/admin workflow after setup.',
    ],
    checklist: [
      'Long press the upper-right login area to reach admin access.',
      'Open the Android menu, set Wi-Fi, and verify the machine clock matches local time.',
      'Hide the Android menu again before handing the machine to staff.',
    ],
    searchTerms: [
      'software setup',
      'admin login',
      'android menu',
      'wifi',
      'network automatic time',
      'local time zone',
    ],
    taskCategory: 'Start Here',
    audience: 'Operator',
    format: 'guide',
    embed: {
      title: 'Software setup quickstart',
      srcDoc: placeholderEmbed('Software setup quickstart'),
    },
    document: softwareSetupQuickstartDocument,
    resources: [
      {
        title: 'Pricing, Passwords, and Payment Settings',
        description: 'Open the next setup guide for prices, guest login, and Nayax payment settings.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'pricing-passwords-payment-settings',
        formatBadge: 'Guide',
      },
      {
        title: 'Alarm and Power Timer Setup',
        description: 'Finish automatic burner start and daily power scheduling after the base setup is complete.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open checklist',
        linkedTrainingId: 'alarm-and-power-timer-setup',
        formatBadge: 'Checklist',
      },
    ],
  },
  {
    id: 'pricing-passwords-payment-settings',
    title: 'Pricing, Passwords, and Payment Settings',
    description:
      'Configure prices, guest and staff passwords, payment mode, and operator-facing contact details.',
    duration: '8 min',
    tags: [
      'Audience: Operator',
      'Task: Software & Payments',
      'Format: Guide',
      'Pricing',
      'Passwords',
      'Payments',
      'Nayax',
    ],
    level: 'Beginner',
    summary:
      'Use this when pricing or payment settings need to be reviewed during launch or venue changes.',
    learningPoints: [
      'Set the key price points called out in the software setup guide without changing unrelated values.',
      'Update the guest and staff passwords so the machine is not left on defaults.',
      'Choose the correct payment mode for the cotton candy machine and confirm public contact info.',
    ],
    checklist: [
      'Set DIY and pattern prices using the current approved values.',
      'Update the guest password and change the default staff password after login.',
      'Confirm the cotton candy machine payment setting is Nayax bill/coin.',
    ],
    searchTerms: [
      'pricing setup',
      'guest password',
      'staff password',
      'nayax bill coin',
      'contact information',
      'currency symbol',
    ],
    taskCategory: 'Software & Payments',
    audience: 'Operator',
    format: 'guide',
    embed: {
      title: 'Pricing, passwords, and payment settings',
      srcDoc: placeholderEmbed('Pricing, passwords, and payment settings'),
    },
    document: pricingAndPaymentsDocument,
    resources: [
      {
        title: 'Software Setup Quickstart',
        description: 'Go back to the entry guide if you need the hidden admin menu steps again.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'software-setup-quickstart',
        formatBadge: 'Guide',
      },
      {
        title: 'Configure Coin Acceptor (Calibration/Setup)',
        description: 'Pair this guide with the video walkthrough for the coin acceptor flow.',
        status: 'available',
        kind: 'video',
        actionLabel: 'Watch video',
        linkedTrainingId: 'configure-coin-acceptor',
        formatBadge: 'Video',
      },
    ],
  },
  {
    id: 'alarm-and-power-timer-setup',
    title: 'Alarm and Power Timer Setup',
    description:
      'Set the burner auto-start alarm and the daily power schedule so the machine opens and closes on time.',
    duration: '6 min',
    tags: [
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Software & Payments',
      'Format: Checklist',
      'Alarm',
      'Timer',
      'Scheduling',
    ],
    level: 'Beginner',
    summary:
      'This is the shortest path to getting the machine ready before opening time without missing the burner warm-up sequence.',
    learningPoints: [
      'Set the local alarm clock that automatically starts the burner.',
      'Configure power-on and power-off timing for daylight saving and winter schedules.',
      'Know when to confirm timer status with engineering before relying on automation.',
    ],
    checklist: [
      'Open the local alarm clock and set the burner start and stop times.',
      'Set the power timer to the approved daylight saving or winter schedule.',
      'Confirm the timer is in auto mode and contact engineering if the timer state is unclear.',
    ],
    searchTerms: [
      'local alarm',
      'power timer',
      'daylight saving',
      'winter time',
      'burner auto start',
    ],
    taskCategory: 'Daily Operation',
    audience: 'Operator',
    format: 'checklist',
    embed: {
      title: 'Alarm and power timer setup',
      srcDoc: placeholderEmbed('Alarm and power timer setup'),
    },
    document: alarmAndPowerTimerDocument,
    resources: [
      {
        title: 'Start-Up & Shutdown Procedure (Safe Power Cycle)',
        description: 'Watch the operational walkthrough that pairs with the timing checklist.',
        status: 'available',
        kind: 'video',
        actionLabel: 'Watch video',
        linkedTrainingId: 'start-up-shutdown-procedure',
        formatBadge: 'Video',
      },
      {
        title: 'Need help?',
        description: 'Reach Bloomjoy support if the machine schedule does not behave as expected.',
        status: 'available',
        kind: 'support',
        actionLabel: 'Go to support',
        href: '/portal/support',
      },
    ],
  },
  {
    id: 'module-map-and-reference-manual',
    title: 'Maintenance Guide Reference Manual',
    description:
      'Use the full maintenance manual to understand the major modules, cleaning points, and inspection steps.',
    duration: '14 min',
    tags: [
      'Audience: Operator',
      'Task: Start Here',
      'Task: Cleaning & Maintenance',
      'Format: Reference',
      'Maintenance',
      'Module map',
    ],
    level: 'Beginner',
    summary:
      'This is the long-form reference for the machine layout and recurring maintenance procedures.',
    learningPoints: [
      'Recognize the main machine modules called out in the maintenance manual.',
      'Understand where the power, cleaning, and function-check procedures live in the manual.',
      'Use the manual as a reference instead of guessing when you need a specific maintenance step.',
    ],
    checklist: [
      'Review the module introduction before your first cleaning or inspection.',
      'Use the power-off procedure before opening the machine for cleaning.',
      'Keep the manual linked from your daily and troubleshooting guides.',
    ],
    searchTerms: [
      'maintenance guide',
      'module introduction',
      'burner module',
      'sink',
      'waste water',
      'shaping knife',
      'filter',
      'stick output module',
    ],
    taskCategory: 'Start Here',
    audience: 'Operator',
    format: 'reference',
    embed: {
      title: 'Maintenance guide reference manual',
      srcDoc: placeholderEmbed('Maintenance guide reference manual'),
    },
    document: maintenanceReferenceDocument,
    resources: [
      {
        title: 'Cleaning and Hygiene Checklist',
        description: 'Jump directly into the day-to-day cleaning steps pulled from the maintenance manual.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'cleaning-and-hygiene-checklist',
        formatBadge: 'Checklist',
      },
      {
        title: 'Module Function Check Guide',
        description: 'Use the inspection guide when you need to test burner, door, air pump, or cooling behavior.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'module-function-check-guide',
        formatBadge: 'Guide',
      },
    ],
  },
  {
    id: 'cleaning-and-hygiene-checklist',
    title: 'Cleaning and Hygiene Checklist',
    description:
      'Follow the daily cleaning points that prevent sugar buildup, debris, and avoidable downtime.',
    duration: '7 min',
    tags: [
      'Audience: Operator',
      'Task: Cleaning & Maintenance',
      'Format: Checklist',
      'Maintenance',
      'Daily',
      'Cleaning',
    ],
    level: 'Beginner',
    summary:
      'Pulls the highest-frequency cleaning steps out of the full maintenance manual into one operator checklist.',
    learningPoints: [
      'Clean the burner, sink, filter, and shaping components in the correct order.',
      'Know which areas collect sugar stains or paper debris during normal use.',
      'Avoid reassembly mistakes that can create operational issues on the next run.',
    ],
    checklist: [
      'Power the machine off fully before cleaning.',
      'Clean burner surfaces, sink, shaping components, filter, and workspace contact points.',
      'Check the stick-output area and sugar-picking area for debris before closing the machine.',
    ],
    searchTerms: [
      'clean burner cover',
      'workspace hygiene',
      'paper debris',
      'filter',
      'sink cleaning',
      'waste water treatment',
    ],
    taskCategory: 'Cleaning & Maintenance',
    audience: 'Operator',
    format: 'checklist',
    embed: {
      title: 'Cleaning and hygiene checklist',
      srcDoc: placeholderEmbed('Cleaning and hygiene checklist'),
    },
    document: cleaningChecklistDocument,
    resources: [
      {
        title: 'Daily Maintenance Routine',
        description: 'Watch the paired video walkthrough for the daily cleaning rhythm.',
        status: 'available',
        kind: 'video',
        actionLabel: 'Watch video',
        linkedTrainingId: 'daily-maintenance-routine',
        formatBadge: 'Video',
      },
      {
        title: 'Maintenance Guide Reference Manual',
        description: 'Return to the full maintenance reference if you need the complete module descriptions.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open manual',
        linkedTrainingId: 'module-map-and-reference-manual',
        formatBadge: 'Reference',
      },
    ],
  },
  {
    id: 'module-function-check-guide',
    title: 'Module Function Check Guide',
    description:
      'Run the module inspection steps when the burner, door, air pump, cooling, or output modules need verification.',
    duration: '10 min',
    tags: [
      'Audience: Operator',
      'Task: Troubleshooting',
      'Task: Cleaning & Maintenance',
      'Format: Guide',
      'Diagnostics',
      'Function check',
    ],
    level: 'Intermediate',
    summary:
      'This guide turns the maintenance manual inspection section into a practical troubleshooting path.',
    learningPoints: [
      'Use the debugging page safely to test the key machine modules.',
      'Verify humidity, cleaning spray, door, stick output, air pump, and water cooling behavior.',
      'Know when a failed function check means you should escalate to support.',
    ],
    checklist: [
      'Power the machine on without starting production.',
      'Use the debugging page to test the target module only.',
      'Escalate with a clear module name and failed behavior if the test does not pass.',
    ],
    searchTerms: [
      'debugging page',
      'burner rotate low speed',
      'humidity start',
      'cleaning spray',
      'automatic door',
      'air pump start',
      'water cooling module',
    ],
    taskCategory: 'Troubleshooting',
    audience: 'Operator',
    format: 'guide',
    embed: {
      title: 'Module function check guide',
      srcDoc: placeholderEmbed('Module function check guide'),
    },
    document: moduleFunctionCheckDocument,
    resources: [
      {
        title: 'Troubleshooting Common Issues',
        description: 'Watch the video overview if you need a faster recovery path before checking module internals.',
        status: 'available',
        kind: 'video',
        actionLabel: 'Watch video',
        linkedTrainingId: 'troubleshooting-common-issues',
        formatBadge: 'Video',
      },
      {
        title: 'Need help?',
        description: 'Escalate with Bloomjoy support when a function test fails.',
        status: 'available',
        kind: 'support',
        actionLabel: 'Go to support',
        href: '/portal/support',
      },
    ],
  },
  {
    id: 'consumables-loading-and-stick-handling',
    title: 'Consumables Loading and Stick Handling',
    description:
      'Use the manual checks for sugar fill level, pipe routing, and paper-stick handling when output quality drops.',
    duration: '6 min',
    tags: [
      'Audience: Operator',
      'Task: Daily Operation',
      'Task: Troubleshooting',
      'Format: Guide',
      'Sugar',
      'Sticks',
      'Consumables',
    ],
    level: 'Beginner',
    summary:
      'This guide focuses on the consumable checks that frequently solve output issues without a repair.',
    learningPoints: [
      'Keep sugar below the fill line and sealed to prevent feed issues.',
      'Check pipe routing and connections before assuming a pump or cleaning failure.',
      'Load paper sticks correctly to avoid jams and missed picks.',
    ],
    checklist: [
      'Keep sugar below the marked fill line and tighten the cap fully after loading.',
      'Check that pipes are smooth, unobstructed, and secured at the connection points.',
      'Load paper sticks flat and stay within the box capacity.',
    ],
    searchTerms: [
      'sugar usage check',
      'pipe usage check',
      'paper stick usage check',
      'fill line',
      'air leaks',
      'stuck sticks',
    ],
    taskCategory: 'Daily Operation',
    audience: 'Operator',
    format: 'guide',
    embed: {
      title: 'Consumables loading and stick handling',
      srcDoc: placeholderEmbed('Consumables loading and stick handling'),
    },
    document: consumablesGuideDocument,
    resources: [
      {
        title: 'Sugar Loading Best Practices',
        description: 'Watch the loading video for the operator rhythm that pairs with these checks.',
        status: 'available',
        kind: 'video',
        actionLabel: 'Watch video',
        linkedTrainingId: 'sugar-loading-best-practices',
        formatBadge: 'Video',
      },
      {
        title: 'Cleaning and Hygiene Checklist',
        description: 'Open the cleaning checklist if debris or residue may be causing the consumable issue.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'cleaning-and-hygiene-checklist',
        formatBadge: 'Checklist',
      },
    ],
  },
  {
    id: 'start-up-shutdown-procedure',
    title: 'Start-Up & Shutdown Procedure (Safe Power Cycle)',
    description: 'Safe startup and shutdown process for daily operation.',
    duration: '5 min',
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Daily Operation',
      'Format: Video',
      'Operations',
      'Safety',
      'Power',
    ],
    level: 'Beginner',
    summary:
      'Use this before opening and closing so the machine is not powered off while the burner is still too hot.',
    learningPoints: [
      'Understand the difference between plugging the machine in, logging in, and fully shutting it down.',
      'Know when the burner is cool enough to unplug the machine.',
      'Use the on-screen temperature state before ending power.',
    ],
    checklist: [
      'Plug the machine in and confirm the status bar is visible.',
      'Use the backend power control instead of unplugging during active heat.',
      'Wait for the burner to cool before unplugging power at shutdown.',
    ],
    searchTerms: ['power on', 'power off', 'safe power cycle', 'burner temperature', 'shutdown'],
    taskCategory: 'Daily Operation',
    audience: 'Operator',
    format: 'video',
    embed: {
      title: 'Safe power cycle walkthrough',
      srcDoc: placeholderEmbed('Safe power cycle walkthrough'),
    },
    resources: [
      {
        title: 'Alarm and Power Timer Setup',
        description: 'Use the schedule guide so the machine is ready before service begins.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open checklist',
        linkedTrainingId: 'alarm-and-power-timer-setup',
        formatBadge: 'Checklist',
      },
      {
        title: 'Need help?',
        description: 'Escalate to support if the machine does not shut down cleanly or the burner does not cool as expected.',
        status: 'available',
        kind: 'support',
        actionLabel: 'Go to support',
        href: '/portal/support',
      },
    ],
  },
  {
    id: 'sugar-loading-best-practices',
    title: 'Sugar Loading Best Practices',
    description: 'Optimal sugar loading techniques for consistent cotton candy production.',
    duration: '8 min',
    tags: [
      'Audience: Operator',
      'Task: Daily Operation',
      'Format: Video',
      'Operations',
      'Sugar',
    ],
    level: 'Beginner',
    summary: 'Dial in sugar loading for consistent output and reduced jams.',
    learningPoints: [
      'Measure the right amount of sugar per run.',
      'Use the correct grain size for the model.',
      'Avoid moisture buildup inside the hopper.',
    ],
    checklist: [
      'Confirm sugar container is sealed and dry.',
      'Load measured quantity only.',
      'Wipe hopper edges after each fill.',
    ],
    searchTerms: ['sugar loading', 'hopper', 'dry sugar', 'feed consistency'],
    taskCategory: 'Daily Operation',
    audience: 'Operator',
    format: 'video',
    embed: {
      title: 'Sugar loading demo',
      srcDoc: placeholderEmbed('Sugar loading demo'),
    },
    resources: [
      {
        title: 'Consumables Loading and Stick Handling',
        description: 'Use the consumables guide for the maintenance-manual checks that pair with this video.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'consumables-loading-and-stick-handling',
        formatBadge: 'Guide',
      },
    ],
  },
  {
    id: 'troubleshooting-common-issues',
    title: 'Troubleshooting Common Issues',
    description: 'Quick fixes for the most common machine issues operators encounter.',
    duration: '15 min',
    tags: [
      'Audience: Operator',
      'Task: Troubleshooting',
      'Format: Video',
      'Troubleshooting',
      'Maintenance',
    ],
    level: 'Intermediate',
    summary: 'Resolve error states, output inconsistencies, and temperature warnings.',
    learningPoints: [
      'Identify error codes and first-line actions.',
      'Diagnose uneven pattern output.',
      'Know when to escalate to manufacturer support.',
    ],
    checklist: [
      'Capture error code and timestamp.',
      'Restart machine after cooling period.',
      'Escalate if issue repeats after two cycles.',
    ],
    searchTerms: ['error code', 'temperature warning', 'output issue', 'diagnostics'],
    taskCategory: 'Troubleshooting',
    audience: 'Operator',
    format: 'video',
    embed: {
      title: 'Troubleshooting walkthrough',
      srcDoc: placeholderEmbed('Troubleshooting walkthrough'),
    },
    resources: [
      {
        title: 'Module Function Check Guide',
        description: 'Run the structured module checks before escalating.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'module-function-check-guide',
        formatBadge: 'Guide',
      },
      {
        title: 'Need help?',
        description: 'Open the support hub if the issue repeats after first-line recovery.',
        status: 'available',
        kind: 'support',
        actionLabel: 'Go to support',
        href: '/portal/support',
      },
    ],
  },
  {
    id: 'daily-maintenance-routine',
    title: 'Daily Maintenance Routine',
    description: 'Keep your machine running smoothly with this daily maintenance checklist.',
    duration: '10 min',
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Cleaning & Maintenance',
      'Format: Video',
      'Maintenance',
      'Daily',
    ],
    level: 'Beginner',
    summary: 'Daily cleaning and inspection checklist to extend uptime.',
    learningPoints: [
      'Clean high-contact surfaces safely.',
      'Spot wear before it becomes downtime.',
      'Schedule end-of-day inspections.',
    ],
    checklist: [
      'Clean sugar bowl and spinner.',
      'Inspect heating element area.',
      'Log any issues for follow-up.',
    ],
    searchTerms: ['daily maintenance', 'daily cleaning', 'burner cover', 'inspection'],
    taskCategory: 'Cleaning & Maintenance',
    audience: 'Operator',
    format: 'video',
    embed: {
      title: 'Daily maintenance demo',
      srcDoc: placeholderEmbed('Daily maintenance demo'),
    },
    resources: [
      {
        title: 'Cleaning and Hygiene Checklist',
        description: 'Open the written checklist pulled from the maintenance manual.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open checklist',
        linkedTrainingId: 'cleaning-and-hygiene-checklist',
        formatBadge: 'Checklist',
      },
    ],
  },
  {
    id: 'configure-coin-acceptor',
    title: 'Configure Coin Acceptor (Calibration/Setup)',
    description: 'Configure and calibrate the coin acceptor module.',
    duration: '3 min',
    tags: [
      'Module 1',
      'Audience: Operator',
      'Task: Software & Payments',
      'Format: Video',
      'Setup',
      'Payments',
    ],
    level: 'Beginner',
    summary:
      'A focused walkthrough for the coin-acceptor setup steps tied to payment readiness.',
    learningPoints: [
      'Navigate to the calibration area without touching unrelated settings.',
      'Pair the video with the payment-settings guide so pricing and coin acceptance stay aligned.',
      'Recognize when you should re-run the calibration after venue or cash hardware changes.',
    ],
    checklist: [
      'Confirm pricing is already set before adjusting payment hardware.',
      'Run the coin-acceptor calibration flow shown in the video.',
      'Test acceptance before opening the machine to guests.',
    ],
    searchTerms: ['coin acceptor', 'calibration', 'payment setup', 'coins'],
    taskCategory: 'Software & Payments',
    audience: 'Operator',
    format: 'video',
    embed: {
      title: 'Configure coin acceptor',
      srcDoc: placeholderEmbed('Configure coin acceptor'),
    },
    resources: [
      {
        title: 'Pricing, Passwords, and Payment Settings',
        description: 'Open the written guide if you also need to confirm prices, passwords, or Nayax settings.',
        status: 'available',
        kind: 'guide',
        actionLabel: 'Open guide',
        linkedTrainingId: 'pricing-passwords-payment-settings',
        formatBadge: 'Guide',
      },
    ],
  },
];

export const trainingTracks: TrainingTrack[] = [
  {
    id: 'operator-essentials',
    slug: 'operator-essentials',
    title: 'Operator Essentials',
    description:
      'The shortest path to safe setup, daily operation, cleaning, and recovery for day-to-day operators.',
    audience: 'Operator',
    certificateTitle: 'Bloomjoy Operator Essentials',
    items: [
      { trainingId: 'software-setup-quickstart', required: true, sortOrder: 1 },
      { trainingId: 'start-up-shutdown-procedure', required: true, sortOrder: 2 },
      { trainingId: 'pricing-passwords-payment-settings', required: true, sortOrder: 3 },
      { trainingId: 'alarm-and-power-timer-setup', required: true, sortOrder: 4 },
      { trainingId: 'daily-maintenance-routine', required: true, sortOrder: 5 },
      { trainingId: 'cleaning-and-hygiene-checklist', required: true, sortOrder: 6 },
      { trainingId: 'consumables-loading-and-stick-handling', required: true, sortOrder: 7 },
      { trainingId: 'module-function-check-guide', required: true, sortOrder: 8 },
    ],
  },
];

export const trainingTags = [...new Set(trainingContent.flatMap((item) => item.tags))];

export const getTrainingItemById = (id: string) =>
  trainingContent.find((item) => item.id === id);

export const getTrainingTags = (items: TrainingContent[]) =>
  [...new Set(items.flatMap((item) => item.tags))];
