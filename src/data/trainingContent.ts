export interface TrainingContent {
  id: string;
  title: string;
  description: string;
  duration: string;
  tags: string[];
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  learningPoints: string[];
  checklist: string[];
  embed: {
    title: string;
    srcDoc: string;
    url?: string;
  };
  resources: Array<{
    title: string;
    description: string;
    status: 'available' | 'coming_soon';
  }>;
}

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
        <div class="subtitle">Embedded training content placeholder. Replace with real video or PDF embed when ready.</div>
      </div>
    </div>
  </body>
</html>`;

export const trainingContent: TrainingContent[] = [
  {
    id: 'machine-setup-basics',
    title: 'Machine Setup Basics',
    description: 'Learn how to properly set up your Bloomjoy machine for first-time use.',
    duration: '12 min',
    tags: ['Setup', 'Beginner'],
    level: 'Beginner',
    summary: 'Walk through unboxing, placement, power, and first-run calibration.',
    learningPoints: [
      'Choose the right placement and power source.',
      'Complete the first-run calibration checklist.',
      'Verify safety sensors before opening for guests.',
    ],
    checklist: [
      'Confirm machine is level and secured.',
      'Connect to dedicated power outlet.',
      'Run test pattern and inspect output.',
    ],
    embed: {
      title: 'Setup walkthrough',
      srcDoc: placeholderEmbed('Setup walkthrough'),
    },
    resources: [
      {
        title: 'Setup checklist (PDF)',
        description: 'Printable checklist for your first setup.',
        status: 'coming_soon',
      },
      {
        title: 'Power requirements guide',
        description: 'Voltage and amperage reference by model.',
        status: 'coming_soon',
      },
    ],
  },
  {
    id: 'sugar-loading-best-practices',
    title: 'Sugar Loading Best Practices',
    description: 'Optimal sugar loading techniques for consistent cotton candy production.',
    duration: '8 min',
    tags: ['Operations', 'Sugar'],
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
    embed: {
      title: 'Sugar loading demo',
      srcDoc: placeholderEmbed('Sugar loading demo'),
    },
    resources: [
      {
        title: 'Sugar storage guide',
        description: 'How to keep sugar dry and clump-free.',
        status: 'available',
      },
    ],
  },
  {
    id: 'troubleshooting-common-issues',
    title: 'Troubleshooting Common Issues',
    description: 'Quick fixes for the most common machine issues operators encounter.',
    duration: '15 min',
    tags: ['Troubleshooting', 'Maintenance'],
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
    embed: {
      title: 'Troubleshooting walkthrough',
      srcDoc: placeholderEmbed('Troubleshooting walkthrough'),
    },
    resources: [
      {
        title: 'Error code cheat sheet',
        description: 'Fast reference for error codes.',
        status: 'available',
      },
      {
        title: 'Escalation template',
        description: 'Message template for WeChat support.',
        status: 'coming_soon',
      },
    ],
  },
  {
    id: 'complex-pattern-programming',
    title: 'Complex Pattern Programming',
    description: 'How to create and customize complex cotton candy patterns.',
    duration: '20 min',
    tags: ['Advanced', 'Patterns'],
    level: 'Advanced',
    summary: 'Layer color and motion to deliver premium patterns.',
    learningPoints: [
      'Adjust pattern speed for guest experience.',
      'Balance sugar flow for multi-color designs.',
      'Save presets for high-traffic events.',
    ],
    checklist: [
      'Load color sequence in correct order.',
      'Test pattern on 1-2 samples before opening.',
      'Save final preset with a clear name.',
    ],
    embed: {
      title: 'Pattern programming demo',
      srcDoc: placeholderEmbed('Pattern programming demo'),
    },
    resources: [
      {
        title: 'Pattern presets library',
        description: 'Suggested presets for parties and events.',
        status: 'coming_soon',
      },
    ],
  },
  {
    id: 'daily-maintenance-routine',
    title: 'Daily Maintenance Routine',
    description: 'Keep your machine running smoothly with this daily maintenance checklist.',
    duration: '10 min',
    tags: ['Maintenance', 'Daily'],
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
    embed: {
      title: 'Daily maintenance demo',
      srcDoc: placeholderEmbed('Daily maintenance demo'),
    },
    resources: [
      {
        title: 'Maintenance log template',
        description: 'Track issues and resolutions.',
        status: 'available',
      },
    ],
  },
  {
    id: 'wechat-support-setup',
    title: 'WeChat Support Setup',
    description: 'How to set up and use WeChat for direct manufacturer support.',
    duration: '5 min',
    tags: ['Support', 'Setup'],
    level: 'Beginner',
    summary: 'Connect with manufacturer support for rapid troubleshooting.',
    learningPoints: [
      'Create a WeChat account and verify your number.',
      'Add the official support contact.',
      'Share machine serial info for faster responses.',
    ],
    checklist: [
      'Install WeChat on a staff phone.',
      'Scan the support QR code from your machine kit.',
      'Send serial number and location details.',
    ],
    embed: {
      title: 'WeChat setup demo',
      srcDoc: placeholderEmbed('WeChat setup demo'),
    },
    resources: [
      {
        title: 'WeChat message template',
        description: 'Copy-ready support request intro.',
        status: 'available',
      },
    ],
  },
];

export const trainingTags = [...new Set(trainingContent.flatMap((item) => item.tags))];

export const getTrainingItemById = (id: string) =>
  trainingContent.find((item) => item.id === id);

export const getTrainingTags = (items: TrainingContent[]) =>
  [...new Set(items.flatMap((item) => item.tags))];
