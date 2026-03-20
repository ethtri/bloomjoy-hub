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
    'Use this guide to set the machine clock, burner auto-start, and daily power window before opening for service.',
  estimatedReadMinutes: 7,
  sourceLabel: 'Software setup manual',
  sections: [
    {
      heading: 'Set local time first',
      paragraphs: [
        'Confirm the machine clock and day of week before changing any timer settings. The timer behavior is unreliable if local time is wrong.',
        'Set current time and day first, then move into the alarm and power timer screens.',
      ],
      bullets: ['Unlock the timer control before editing settings.', 'Do not leave the page until time and day are correct.'],
    },
    {
      heading: 'Local alarm controls burner auto-start',
      bullets: [
        'Opening time: 9:30',
        'Closing time: 20:30',
        'Use the local alarm for burner warm-up timing, not full machine power scheduling.',
      ],
    },
    {
      heading: 'Power timer controls machine on and off',
      bullets: [
        'Daylight saving / summer schedule: on at 9:00, off at 23:00.',
        'Winter schedule: on at 8:00, off at 22:00.',
        'After programming the schedule, leave the timer in Auto mode.',
      ],
    },
    {
      heading: 'Timer control reference',
      bullets: [
        'Lock / unlock: enter edit mode before changing settings.',
        'Hours, minutes, and day-of-week buttons: set the current time first, then the on/off window.',
        'Timer and Time buttons: switch between schedule programming and current time display.',
        'On / Auto / Off: finish on Auto so the schedule runs by itself.',
      ],
    },
    {
      heading: 'Final verification',
      paragraphs: [
        'Confirm the machine shows the approved open and close window for the current season before you leave setup.',
        'If any timer status is unclear, confirm it with a Bloomjoy engineer before the venue launches.',
      ],
    },
  ],
};

export const maintenanceReferenceDocument: TrainingDocument = {
  title: 'Maintenance guide reference manual',
  intro:
    'This reference pulls the highest-value operator tasks out of the maintenance guide so you can find shutdown, cleaning, check, and refill steps faster.',
  estimatedReadMinutes: 14,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Start and stop safely',
      paragraphs: [
        'Use the backend power flow instead of unplugging the machine during heat or cooldown.',
        'The maintenance guide calls out a hard stop condition: do not unplug the machine until the burner cools to 60°C.',
      ],
      bullets: [
        'Log in to the backend before changing machine state.',
        'Wait for the burner to cool to 60°C before unplugging power.',
        'Use this shutdown path before opening the machine for cleaning.',
      ],
    },
    {
      heading: 'Daily cleaning hotspots',
      bullets: [
        'Burner outlet and burner base cleaning surfaces',
        'Sink placement and reassembly points',
        'Shaping-knife roller and nearby debris traps',
        'Stick-output path and sugar-pickup / sensor area',
        'Filter dry-before-reinstall requirement',
      ],
    },
    {
      heading: 'Machine checks from the debug page',
      bullets: [
        'Verify burner rotation before heating.',
        'Run humidification and cleaning spray checks.',
        'Check stick output, automatic door movement, and robot sensors.',
        'Inspect air pump flow and water-cooling circulation before escalating.',
      ],
    },
    {
      heading: 'Refill and reload correctly',
      bullets: [
        'Keep sugar below the fill line and seal the sugar cap tightly.',
        'Check pipe routing and check-valve direction before assuming a mechanical fault.',
        'Stay within paper-stick box capacity and keep sticks laid flat during loading.',
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
      heading: 'Before you open the machine',
      bullets: [
        'Use the safe shutdown flow before cleaning so the burner has cooled correctly.',
        'Remove the sink first so the burner area can be accessed safely.',
        'Keep the waste-water pipe positioned correctly before and after cleaning.',
      ],
    },
    {
      heading: 'Daily cleaning hotspots',
      bullets: [
        'Clean the burner cover outlet thoroughly and reassemble with the gasket in place.',
        'Use fine sandpaper on the main base cleaning area where the manual calls for it.',
        'Clean the shaping-knife roller and the stick-output area where paper debris collects.',
        'Clear the sugar-pickup and sensor area if residue or stick faults are present.',
      ],
    },
    {
      heading: 'Interior hygiene',
      bullets: [
        'Wipe the marked cabinet surfaces and glass with a damp cloth.',
        'Remove and clean the tail-wire protective sheet metal clips where debris collects.',
        'Keep the removable filter clean and fully dry before reinstalling it.',
      ],
    },
    {
      heading: 'Closeout checks',
      paragraphs: [
        'Return the waste-water pipe to the bucket and keep it level after cleaning.',
        'Confirm the filter is dry, the sink is seated, and moving parts rotate freely before restarting the machine.',
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
      bullets: ['Verify burner rotation before you allow any heating test.', 'Use the debugging page instead of guessing from symptoms alone.'],
    },
    {
      heading: 'Key checks',
      bullets: [
        'Burner low-speed rotation before heat is applied',
        'Humidification and cleaning spray output',
        'Stick output module, automatic door movement, and robot sensor behavior',
        'Air pump airflow, cooling fan operation, and water-cooling circulation',
      ],
    },
    {
      heading: 'Escalation notes',
      paragraphs: [
        'If a module fails a guided check, capture the module name, the failed action, and the machine status before contacting support.',
        'Call out whether the issue appeared during burner, door, air, cooling, or output testing so support can route the case faster.',
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
