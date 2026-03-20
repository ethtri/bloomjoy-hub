import type { TrainingDocument } from '@/lib/trainingTypes';

export const softwareSetupQuickstartDocument: TrainingDocument = {
  title: 'Software setup quickstart',
  intro:
    'This guide condenses the attached software setup manual into the first actions an operator needs most often during setup.',
  estimatedReadMinutes: 9,
  sourceLabel: 'Software setup manual',
  sections: [
    {
      heading: 'Open the admin path safely',
      paragraphs: [
        'Long press the upper-right corner of the screen to reach the administrator login page.',
        'Enter the original password 123456, then long press the circular icon until the Android menu bar appears.',
      ],
      bullets: [
        'Do not log in before the Android menu appears.',
        'Tap the circle icon again to reveal the settings gear.',
      ],
    },
    {
      heading: 'Set connectivity and local time first',
      paragraphs: [
        'Open settings and configure Wi-Fi before changing settings that depend on time or payment services.',
        'Turn on automatic network time, set the local time zone, and confirm the displayed machine time matches venue time.',
      ],
    },
    {
      heading: 'Return to normal admin mode',
      paragraphs: [
        'Close the Android menu once setup is complete, return to the login page, and long press again to hide the menu bar.',
        'Log in to the administrator account only after the machine is back in normal mode.',
      ],
    },
  ],
};

export const pricingAndPaymentsDocument: TrainingDocument = {
  title: 'Pricing, passwords, and payment settings',
  intro:
    'This guide pulls together the pricing, password, payment, and contact settings from the software setup manual.',
  estimatedReadMinutes: 8,
  sourceLabel: 'Software setup manual',
  sections: [
    {
      heading: 'Price setup',
      bullets: [
        'Set the DIY and pattern prices using the approved values shown in the setup guide.',
        'On old software versions, update the gold-coin column and ignore the Yuan column.',
        'Review any popcorn-only screens separately so cotton candy settings are not copied by mistake.',
      ],
    },
    {
      heading: 'Passwords and account access',
      paragraphs: [
        'Enable guest login where required, then move to the staff area and change the default 123456 password after first login.',
        'Keep updated passwords in Bloomjoy operations records, not only on the machine.',
      ],
    },
    {
      heading: 'Payment and contact settings',
      bullets: [
        'For cotton candy machines, choose Nayax bill/coin as the payment type.',
        'Update the phone number and email shown in the machine contact fields.',
        'Change the local currency symbol to $.',
      ],
    },
  ],
};

export const alarmAndPowerTimerDocument: TrainingDocument = {
  title: 'Alarm and power timer setup',
  intro:
    'Use this checklist to keep automatic warm-up and shutdown aligned with local operating hours.',
  estimatedReadMinutes: 6,
  sourceLabel: 'Software setup manual',
  sections: [
    {
      heading: 'Local alarm settings',
      paragraphs: [
        'The local alarm controls automatic burner start and is called out as a critical machine function in the setup guide.',
        'Set the opening and closing times to the approved local operating window before testing power automation.',
      ],
    },
    {
      heading: 'Power timer settings',
      bullets: [
        'During daylight saving time, use the summer schedule from the guide.',
        'During winter time, use the winter schedule from the guide.',
        'Leave the timer in auto mode after settings are confirmed.',
      ],
    },
    {
      heading: 'Final verification',
      paragraphs: [
        'Check that the machine clock is correct before trusting any timer behavior.',
        'If the timer state is unclear, contact an engineer before venue launch.',
      ],
    },
  ],
};

export const maintenanceReferenceDocument: TrainingDocument = {
  title: 'Maintenance guide reference manual',
  intro:
    'This reference condenses the attached maintenance guide so operators can find the right section faster during startup, cleaning, and inspection.',
  estimatedReadMinutes: 14,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Machine module map',
      bullets: [
        'Burner module',
        'Sink',
        'Waste water bucket',
        'Shaping knife',
        'Removable filter',
        'Stick output module',
        'Stick picking module',
        'Tail wire collection module',
      ],
    },
    {
      heading: 'Power operations in the manual',
      paragraphs: [
        'The maintenance manual includes separate power-on, turning on and off, and full power-off steps.',
        'The shutdown section matters because the burner must cool before the machine is unplugged.',
      ],
    },
    {
      heading: 'Where to go next',
      bullets: [
        'Use the cleaning checklist for day-to-day sanitation and debris control.',
        'Use the function check guide when a module does not behave as expected.',
        'Use the consumables guide when sugar, pipes, or paper sticks may be causing the issue.',
      ],
    },
  ],
};

export const cleaningChecklistDocument: TrainingDocument = {
  title: 'Cleaning and hygiene checklist',
  intro:
    'Use this checklist for the highest-frequency cleaning and hygiene tasks pulled from the maintenance guide.',
  estimatedReadMinutes: 7,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Burner and sink',
      bullets: [
        'Remove the sink first so the burner cover can be accessed safely.',
        'Clean the burner cover outlet thoroughly and reassemble with the gasket in place.',
        'Use fine sandpaper on the main base cleaning area where the manual calls for it.',
      ],
    },
    {
      heading: 'Interior hygiene',
      bullets: [
        'Wipe the marked cabinet surfaces and glass with a damp cloth.',
        'Remove and clean the tail-wire protective sheet metal clips where debris collects.',
        'Clean the stick-output area where paper-stick friction creates residue.',
      ],
    },
    {
      heading: 'Closeout checks',
      paragraphs: [
        'Return the waste water pipe to the bucket and keep it level after cleaning.',
        'Make sure filters are dry before reinstalling and confirm moving parts rotate freely after cleaning.',
      ],
    },
  ],
};

export const moduleFunctionCheckDocument: TrainingDocument = {
  title: 'Module function check guide',
  intro:
    'Use this guide when a module needs a structured function check before you open a support request.',
  estimatedReadMinutes: 10,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Before you test',
      paragraphs: [
        'The maintenance manual calls for powering the machine on without starting it before using the debugging page.',
        'Test one module at a time so you can describe the failure clearly if support escalation is needed.',
      ],
    },
    {
      heading: 'Key checks',
      bullets: [
        'Burner low-speed rotation and heating behavior',
        'Humidity and cleaning spray output',
        'Stick output module and automatic door movement',
        'Air pump airflow and water-cooling circulation',
      ],
    },
    {
      heading: 'Escalation notes',
      paragraphs: [
        'If a module fails a guided check, capture the module name, the failed action, and the machine status before contacting support.',
      ],
    },
  ],
};

export const consumablesGuideDocument: TrainingDocument = {
  title: 'Consumables loading and stick handling',
  intro:
    'Use these consumable checks first when machine output changes but the hardware appears healthy.',
  estimatedReadMinutes: 6,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Sugar usage',
      bullets: [
        'Do not exceed the marked fill line in the sugar box.',
        'Tap sugar gently to distribute it evenly.',
        'Tighten the cap fully to avoid air leaks that stop sugar dispensing.',
      ],
    },
    {
      heading: 'Pipe checks',
      bullets: [
        'Keep pipes smooth and unobstructed.',
        'Check the connection point that can loosen and create leaks.',
        'Verify check-valve direction if liquid flow appears wrong.',
      ],
    },
    {
      heading: 'Paper sticks',
      bullets: [
        'Stay within the stated stick-box capacity.',
        'Lay sticks flat when loading to avoid feed problems.',
      ],
    },
  ],
};
