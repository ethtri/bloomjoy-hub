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
      visual: {
        src: '/training-guides/software-admin-access.jpg',
        alt: 'Software setup manual page showing the upper-right long press, the administrator login screen, and the Android menu bar reveal steps.',
        caption: 'Source page from the software setup PDF covering the hidden admin-access gesture and the Android menu reveal.',
      },
    },
    {
      heading: 'Set connectivity and local time first',
      paragraphs: [
        'Open settings and configure Wi-Fi before changing settings that depend on time or payment services.',
        'Turn on automatic network time, set the local time zone, and confirm the displayed machine time matches venue time.',
      ],
      visual: {
        src: '/training-guides/software-wifi-timezone.jpg',
        alt: 'Software setup manual page showing the settings screen for Wi-Fi, automatic network time, and local time zone confirmation.',
        caption: 'Source page from the software setup PDF showing the Wi-Fi and date-time screens used during first setup.',
      },
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
      visual: {
        src: '/training-guides/software-price-settings.jpg',
        alt: 'Software setup manual page showing the cotton candy price-edit screen and the highlighted price rows that should be updated.',
        caption: 'Source page from the software setup PDF showing the price-edit screen used for DIY and pattern pricing.',
      },
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
      visual: {
        src: '/training-guides/software-payment-settings.jpg',
        alt: 'Software setup manual page showing the staff-password, Nayax payment selection, and related software settings screens.',
        caption: 'Source page from the software setup PDF showing the password-change and Nayax payment settings context.',
      },
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
      visual: {
        src: '/training-guides/local-alarm-setting.jpg',
        alt: 'Software setup guide page showing the local alarm screen with the approved opening and closing times for burner auto-start.',
        caption: 'Source screenshot from the software setup PDF showing the local alarm screen used for burner auto-start timing.',
      },
    },
    {
      heading: 'Power timer controls machine on and off',
      paragraphs: [
        'The software setup guide shows the approved daily power window directly on the timer-setting screen, so operators can confirm the exact open and close hours before leaving the controller in Auto mode.',
      ],
      bullets: [
        'Daylight saving / summer schedule: on at 9:00, off at 23:00.',
        'Winter schedule: on at 8:00, off at 22:00.',
        'After programming the schedule, leave the timer in Auto mode.',
      ],
      visual: {
        src: '/training-guides/power-timer-setting.jpg',
        alt: 'Software setup guide page showing the approved power timer setting screen with summer and winter operating windows.',
        caption: 'Source screenshot from the software setup PDF showing the timer-setting screen and approved operating windows.',
      },
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

export const timerControlReferenceDocument: TrainingDocument = {
  title: 'Timer control reference',
  intro:
    'Use this quick visual when you are standing at the timer controller and need to confirm what each button does.',
  estimatedReadMinutes: 3,
  sourceLabel: 'Software setup manual',
  sections: [
    {
      heading: 'Use the controller photo while you program the schedule',
      paragraphs: [
        'The final page of the software setup PDF includes the clearest button legend for the timer controller.',
        'Keep this image open while you set local time, the burner auto-start window, and the machine power schedule.',
      ],
      visual: {
        src: '/training-guides/timer-control-reference.jpg',
        alt: 'Annotated timer controller showing lock or unlock, on auto off, timer, time, adjust hours, adjust minute, and adjust day of week buttons.',
        caption: 'Annotated controller reference pulled from the final page of the software setup PDF.',
      },
    },
    {
      heading: 'Program the controller in this order',
      bullets: [
        'Unlock the controller.',
        'Set current time and day of week.',
        'Program the on and off times.',
        'Switch the controller to Auto.',
        'Verify the approved opening and shutdown window for the current season.',
      ],
    },
    {
      heading: 'Approved operating windows',
      bullets: [
        'Local alarm: open at 9:30, close at 20:30.',
        'Summer power timer: on at 9:00, off at 23:00.',
        'Winter power timer: on at 8:00, off at 22:00.',
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
        'The maintenance guide calls out a hard stop condition: do not unplug the machine until the burner cools to 60 C.',
      ],
      bullets: [
        'Log in to the backend before changing machine state.',
        'Wait for the burner to cool to 60 C before unplugging power.',
        'Use this shutdown path before opening the machine for cleaning.',
      ],
      visual: {
        src: '/training-guides/shutdown-cooldown-reference.jpg',
        alt: 'Maintenance guide page showing the powered-off machine state and the 60 C cooldown requirement before unplugging.',
        caption: 'Maintenance-guide shutdown reference showing the powered-off state and the burner cooldown threshold.',
      },
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
      visual: {
        src: '/training-guides/daily-cleaning-output-sensor.jpg',
        alt: 'Maintenance guide page highlighting the output-path friction points and sugar-pickup sensor area that require routine cleaning.',
        caption: 'Maintenance-guide hotspot visual for the output path and sensor cleanup areas that most often affect the next run.',
      },
    },
    {
      heading: 'Machine checks from the debug page',
      bullets: [
        'Verify burner rotation before heating.',
        'Run humidification and cleaning spray checks.',
        'Check stick output, automatic door movement, and robot sensors.',
        'Inspect air pump flow and water-cooling circulation before escalating.',
      ],
      visual: {
        src: '/training-guides/module-function-debug-page.jpg',
        alt: 'Maintenance guide page showing the backend debugging page used for structured module checks.',
        caption: 'Maintenance-guide debug-page visual used for structured burner, door, sensor, and pump checks.',
      },
    },
    {
      heading: 'Refill and reload correctly',
      bullets: [
        'Keep sugar below the fill line and seal the sugar cap tightly.',
        'Check pipe routing and check-valve direction before assuming a mechanical fault.',
        'Stay within paper-stick box capacity and keep sticks laid flat during loading.',
      ],
      visual: {
        src: '/training-guides/consumables-sugar-fill-line.jpg',
        alt: 'Maintenance guide page showing the sugar container with the red maximum fill line operators should not exceed.',
        caption: 'Maintenance-guide consumables reference showing the sugar bin fill line that should not be exceeded.',
      },
    },
  ],
};

export const safePowerOffAndCooldownDocument: TrainingDocument = {
  title: 'Safe power off and cooldown',
  intro:
    'Use this shutdown checklist any time you are ending service or opening the machine for cleaning.',
  estimatedReadMinutes: 4,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Follow the backend shutdown path first',
      paragraphs: [
        'Do not unplug the machine while it is actively heating or while the burner is still cooling.',
        'Use the on-screen shutdown flow so the machine can move through its normal stop sequence.',
      ],
    },
    {
      heading: 'Critical cooldown rule',
      paragraphs: [
        'The maintenance guide states that shutdown is not complete until the burner temperature drops to 60 C and the burner stops rotating.',
        'Use the on-screen temperature status during cooldown instead of guessing from elapsed time alone.',
      ],
      bullets: [
        'Wait until the burner cools to 60 C before unplugging the machine.',
        'If the burner is still above 60 C, keep power connected and continue monitoring cooldown.',
        'Use this same rule before opening the machine for cleaning or inspection.',
      ],
      visual: {
        src: '/training-guides/shutdown-cooldown-reference.jpg',
        alt: 'Maintenance guide page showing the powered-off machine state and the shutdown text that calls for waiting until the burner cools to 60 C before unplugging.',
        caption: 'Source page from the maintenance guide covering the 60 C cooldown threshold and powered-off state.',
      },
    },
    {
      heading: 'Before you walk away',
      bullets: [
        'Confirm the machine is idle and not in an active heat cycle.',
        'Check that waste-water and interior components are left in a safe resting state.',
        'Escalate to support if the burner does not cool as expected.',
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
      paragraphs: [
        'The maintenance guide does not treat burner cleanup as a generic wipe-down. It calls out the burner outlet, base, sink alignment, and the areas where paper debris or residue create follow-up faults on the next run.',
      ],
      bullets: [
        'Clean the burner cover outlet thoroughly and reassemble with the gasket in place.',
        'Use fine sandpaper on the main base cleaning area where the manual calls for it.',
        'Clean the shaping-knife roller and the stick-output area where paper debris collects.',
        'Clear the sugar-pickup and sensor area if residue or stick faults are present.',
      ],
      visual: {
        src: '/training-guides/daily-cleaning-burner-base.jpg',
        alt: 'Maintenance guide page showing the burner base cleaning area and sink alignment figure used during daily cleaning.',
        caption: 'Source page from the maintenance guide showing the burner-base cleaning zone and sink placement reference.',
      },
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
      visual: {
        src: '/training-guides/daily-cleaning-output-sensor.jpg',
        alt: 'Maintenance guide page highlighting the stick-output friction points and sugar-pickup sensor area that need daily cleaning.',
        caption: 'Source page from the maintenance guide showing the stick-output and sensor areas that collect debris.',
      },
    },
  ],
};

export const dailyCleaningHotspotsDocument: TrainingDocument = {
  title: 'Daily cleaning hotspots',
  intro:
    'Use this quick hotspot guide to target the areas that collect the most sugar residue, paper debris, and sensor contamination.',
  estimatedReadMinutes: 5,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Burner and sink zone',
      bullets: [
        'Clean the burner outlet and burner base thoroughly.',
        'Remove the sink first and reseat it correctly during reassembly.',
        'Keep the gasket and surrounding burner parts seated before restart.',
      ],
    },
    {
      heading: 'Output and sensor zone',
      paragraphs: [
        'Use this visual pass when you need the fastest way to clear the debris points that most often cause missed picks, stick jams, or sensor faults.',
      ],
      bullets: [
        'Clear the stick-output path where paper-stick friction creates debris.',
        'Check the sugar-pickup and sensor area if sticks are missed or material flow looks inconsistent.',
        'Inspect nearby rollers and moving parts for residue before closing the machine.',
      ],
      visual: {
        src: '/training-guides/daily-cleaning-output-sensor.jpg',
        alt: 'Maintenance guide page showing the stick-output module friction points and sugar-pickup sensor area called out for daily cleaning.',
        caption: 'Quick-reference source visual from the maintenance guide for the output path and sensor cleanup points.',
      },
    },
    {
      heading: 'Filter and cabinet closeout',
      bullets: [
        'Clean the removable filter and let it dry fully before reinstalling it.',
        'Wipe the marked cabinet surfaces and glass after debris is removed.',
        'Return the waste-water pipe to the correct position before restart.',
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
      visual: {
        src: '/training-guides/module-function-debug-page.jpg',
        alt: 'Maintenance guide page showing the debugging screen with the module test buttons used for guided checks.',
        caption: 'Start with the debugging page so each module test is run intentionally instead of guessing from symptoms.',
      },
    },
    {
      heading: 'Key checks',
      paragraphs: [
        'The manual’s debug-page flow is specific: verify burner rotation before any heating test, then move through humidity, cleaning spray, stick output, door, air-pump, and cooling checks one module at a time.',
      ],
      bullets: [
        'Burner low-speed rotation before heat is applied, then Heat and Start only after rotation looks normal',
        'Humidification and cleaning spray output from the debugging page controls',
        'Stick output module, automatic door movement, and robot sensor behavior',
        'Air pump airflow, cooling fan operation, and water-cooling circulation',
      ],
      visual: {
        src: '/training-guides/module-function-stick-output.jpg',
        alt: 'Maintenance guide page showing the stick output and nearby module checks called out during function testing.',
        caption: 'Verify output and adjacent module behavior in the sequence shown by the maintenance guide before escalating a failure.',
      },
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
      paragraphs: [
        'The maintenance guide ties output quality directly to fill level and cap seal. It specifically warns operators not to exceed the marked line in the sugar box and to tighten the cap fully after loading.',
      ],
      bullets: [
        'Do not exceed the marked fill line in the sugar box.',
        'Tap sugar gently to distribute it evenly.',
        'Tighten the cap fully to avoid air leaks that stop sugar dispensing.',
      ],
      visual: {
        src: '/training-guides/consumables-sugar-fill-line.jpg',
        alt: 'Maintenance guide image showing the sugar container with a red maximum fill line.',
        caption: 'Do not load sugar above the red line shown in the maintenance guide. Overfilling changes feed behavior and output quality.',
      },
    },
    {
      heading: 'Pipe checks',
      paragraphs: [
        'Check the pipe path before assuming a mechanical fault. The maintenance guide points operators to the line position at the bottom of the bucket and the connection point that most often creates leaks or feed issues.',
      ],
      bullets: [
        'Keep pipes smooth and unobstructed.',
        'Check the connection point that can loosen and create leaks.',
        'Verify check-valve direction if liquid flow appears wrong.',
      ],
      visual: {
        src: '/training-guides/consumables-pipe-checks.jpg',
        alt: 'Maintenance guide page showing the consumables pipe routing and the connection point that commonly loosens.',
        caption: 'Check the routed line and connection point before assuming the pump or feed hardware has failed.',
      },
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

export const consumablesLoadingReferenceDocument: TrainingDocument = {
  title: 'Consumables loading reference',
  intro:
    'Use this quick reference when output quality changes but the machine hardware appears healthy.',
  estimatedReadMinutes: 4,
  sourceLabel: 'Cotton Candy Maintenance Guide',
  sections: [
    {
      heading: 'Sugar loading',
      bullets: [
        'Keep sugar below the marked fill line.',
        'Tap sugar gently to level it instead of packing it down hard.',
        'Tighten the sugar cap fully so air leaks do not interrupt dispensing.',
      ],
      visual: {
        src: '/training-guides/consumables-sugar-fill-line.jpg',
        alt: 'Maintenance guide quick-reference image showing the red maximum fill line for the sugar container.',
        caption: 'Stay below the red line when loading sugar so the feed path and cap seal behave correctly.',
      },
    },
    {
      heading: 'Pipe routing and flow',
      bullets: [
        'Keep pipes smooth, unobstructed, and fully seated at the connection points.',
        'Check the line that commonly loosens before assuming a pump failure.',
        'Verify check-valve direction if flow or feed behavior looks wrong.',
      ],
      visual: {
        src: '/training-guides/consumables-pipe-checks.jpg',
        alt: 'Maintenance guide quick-reference page showing the consumables pipe routing and connection checks.',
        caption: 'Quick-reference source visual for pipe routing, connection, and check-valve checks.',
      },
    },
    {
      heading: 'Paper-stick loading',
      bullets: [
        'Stay within the stick-box capacity listed in the maintenance guide.',
        'Lay sticks flat during loading so the pickup path stays consistent.',
        'Recheck loading orientation if the machine misses picks or jams repeatedly.',
      ],
    },
  ],
};
