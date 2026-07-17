import {
  plannerBudgetLabels,
  type PlannerBudget,
  type PlannerBudgetKey,
  type PlannerMachineId,
} from "@/data/businessPlaybookPlanner";

export type PaybackScenarioId = PlannerMachineId;

export type CommercialPaybackInputs = {
  pricePerServing: number;
  variableCostPerServing: number;
  paymentFeePercent: number;
  paymentFeeFlat: number;
  dailyFootTraffic: number;
  familyParentPresencePercent: number;
  impulseCaptureRatePercent: number;
  serviceHoursPerDay: number;
  practicalOrdersPerHour: number;
  operatingDaysPerMonth: number;
  downtimePercent: number;
  monthlyRent: number;
  revenueSharePercent: number;
  monthlyLaborHours: number;
  hourlyLaborCost: number;
  fixedMonthlyCosts: number;
  serviceRestockCosts: number;
};

export type EventPaybackInputs = {
  pricePerServing: number;
  variableCostPerServing: number;
  paymentFeePercent: number;
  paymentFeeFlat: number;
  eventsPerMonth: number;
  averageEventAttendance: number;
  guestFitPercent: number;
  eventCaptureRatePercent: number;
  serviceHoursPerEvent: number;
  practicalOrdersPerHour: number;
  competingTreatsPressurePercent: number;
  downtimePercent: number;
  eventCostsPerEvent: number;
  staffingTravelPerEvent: number;
  fixedMonthlyCosts: number;
};

export type PaybackInputs = {
  commercial: CommercialPaybackInputs;
  event: EventPaybackInputs;
};

export type PaybackPreset = {
  id: string;
  scenario: PaybackScenarioId;
  title: string;
  description: string;
  startupCosts: PlannerBudget;
  inputs: PaybackInputs;
};

export const paybackPlannerPath = "/resources/business-playbook/payback-planner";

export const paybackPlannerSource = encodeURIComponent(paybackPlannerPath);

export const paybackPresetDisclaimer =
  "Fictional example only. Not Bloomjoy performance data, not expected sales, and not a promise of payback.";

export const paybackScenarioProfiles: Record<
  PaybackScenarioId,
  {
    label: string;
    shortLabel: string;
    contactInterest: string;
    description: string;
    planningNotes: string[];
    articleHref: string;
    articleLabel: string;
    defaultStartupCosts: PlannerBudget;
  }
> = {
  commercial: {
    label: "Commercial placement",
    shortLabel: "Commercial",
    contactInterest: "commercial",
    description:
      "A fixed or semi-fixed venue placement where sales depend on foot traffic, family presence, dwell time, visibility, uptime, and venue terms.",
    planningNotes: [
      "Request a quote, then enter the quoted machine amount here. Confirm whether it includes freight, tariffs, duties, brokerage, delivery, and setup.",
      "Revenue share and rent can materially change the payback math, so model both before negotiating.",
      "Family traffic matters. Parents buying for kids are usually the demand signal to validate.",
    ],
    articleHref:
      "/resources/business-playbook/best-locations-for-cotton-candy-vending-machines",
    articleLabel: "Read the location guide",
    defaultStartupCosts: {
      machine: 0,
      importFreight: 0,
      accessoriesPayment: 350,
      deliverySetup: 800,
      openingSupplies: 450,
      localReadiness: 500,
      operatingBuffer: 750,
    },
  },
  mini: {
    label: "Mini events",
    shortLabel: "Mini",
    contactInterest: "mini",
    description:
      "A staffed event or catering path where sales depend on bookings, event size, serving window, menu simplicity, weather, staffing, and competing treats.",
    planningNotes: [
      "Mini list price is only one part of launch cost; shipping, accessories, opening supplies, and event kit needs still matter.",
      "Event sales are shaped by attendance, event length, line management, staffing, and whether other sweet-treat vendors are nearby.",
      "Do not price the event from best-case attendance. Build in travel, setup, cleanup, and slower-service moments.",
    ],
    articleHref:
      "/resources/business-playbook/mini-micro-event-catering-business-guide",
    articleLabel: "Read the event guide",
    defaultStartupCosts: {
      machine: 4000,
      importFreight: 0,
      accessoriesPayment: 250,
      deliverySetup: 350,
      openingSupplies: 250,
      localReadiness: 300,
      operatingBuffer: 400,
    },
  },
  micro: {
    label: "Micro test",
    shortLabel: "Micro",
    contactInterest: "micro",
    description:
      "A compact lower-volume test where basic shapes are enough and the goal is to learn whether the offer earns more attention before scaling.",
    planningNotes: [
      "Micro is the simpler starting point, but lower complexity can also mean lower throughput and simpler output.",
      "Use it for lower-volume validation, not as a shortcut around event planning or location fit.",
      "Model conservative serving counts if the event has competing desserts or if the service window is short.",
    ],
    articleHref: "/resources/business-playbook/commercial-vending-vs-event-catering",
    articleLabel: "Compare operating paths",
    defaultStartupCosts: {
      machine: 2200,
      importFreight: 0,
      accessoriesPayment: 200,
      deliverySetup: 200,
      openingSupplies: 150,
      localReadiness: 250,
      operatingBuffer: 300,
    },
  },
};

export const startupCostKeys: PlannerBudgetKey[] = [
  "machine",
  "importFreight",
  "accessoriesPayment",
  "deliverySetup",
  "openingSupplies",
  "localReadiness",
  "operatingBuffer",
];

export const paybackStartupCostLabels = plannerBudgetLabels;

export const blankStartupCosts: PlannerBudget = {
  machine: 0,
  importFreight: 0,
  accessoriesPayment: 0,
  deliverySetup: 0,
  openingSupplies: 0,
  localReadiness: 0,
  operatingBuffer: 0,
};

export const blankCommercialPaybackInputs: CommercialPaybackInputs = {
  pricePerServing: 0,
  variableCostPerServing: 0,
  paymentFeePercent: 0,
  paymentFeeFlat: 0,
  dailyFootTraffic: 0,
  familyParentPresencePercent: 0,
  impulseCaptureRatePercent: 0,
  serviceHoursPerDay: 0,
  practicalOrdersPerHour: 0,
  operatingDaysPerMonth: 0,
  downtimePercent: 0,
  monthlyRent: 0,
  revenueSharePercent: 0,
  monthlyLaborHours: 0,
  hourlyLaborCost: 0,
  fixedMonthlyCosts: 0,
  serviceRestockCosts: 0,
};

export const blankEventPaybackInputs: EventPaybackInputs = {
  pricePerServing: 0,
  variableCostPerServing: 0,
  paymentFeePercent: 0,
  paymentFeeFlat: 0,
  eventsPerMonth: 0,
  averageEventAttendance: 0,
  guestFitPercent: 0,
  eventCaptureRatePercent: 0,
  serviceHoursPerEvent: 0,
  practicalOrdersPerHour: 0,
  competingTreatsPressurePercent: 0,
  downtimePercent: 0,
  eventCostsPerEvent: 0,
  staffingTravelPerEvent: 0,
  fixedMonthlyCosts: 0,
};

export const blankPaybackInputs: PaybackInputs = {
  commercial: blankCommercialPaybackInputs,
  event: blankEventPaybackInputs,
};

export const paybackPresets: PaybackPreset[] = [
  {
    id: "commercial-pilot-example",
    scenario: "commercial",
    title: "Commercial pilot example",
    description:
      "A fictional family-venue pilot with modest daily order assumptions; enter your quoted machine amount.",
    startupCosts: {
      machine: 0,
      importFreight: 1800,
      accessoriesPayment: 500,
      deliverySetup: 900,
      openingSupplies: 550,
      localReadiness: 600,
      operatingBuffer: 900,
    },
    inputs: {
      commercial: {
        pricePerServing: 8,
        variableCostPerServing: 1.2,
        paymentFeePercent: 3,
        paymentFeeFlat: 0.3,
        dailyFootTraffic: 900,
        familyParentPresencePercent: 25,
        impulseCaptureRatePercent: 5,
        serviceHoursPerDay: 8,
        practicalOrdersPerHour: 10,
        operatingDaysPerMonth: 24,
        downtimePercent: 5,
        monthlyRent: 400,
        revenueSharePercent: 10,
        monthlyLaborHours: 10,
        hourlyLaborCost: 16,
        fixedMonthlyCosts: 150,
        serviceRestockCosts: 220,
      },
      event: blankEventPaybackInputs,
    },
  },
  {
    id: "mini-birthday-event-example",
    scenario: "mini",
    title: "Mini birthday/event example",
    description:
      "A fictional local event setup with a few monthly bookings and a light sweet-treat competition adjustment.",
    startupCosts: {
      machine: 4000,
      importFreight: 650,
      accessoriesPayment: 350,
      deliverySetup: 350,
      openingSupplies: 300,
      localReadiness: 350,
      operatingBuffer: 500,
    },
    inputs: {
      commercial: blankCommercialPaybackInputs,
      event: {
        pricePerServing: 8,
        variableCostPerServing: 1.15,
        paymentFeePercent: 3,
        paymentFeeFlat: 0.3,
        eventsPerMonth: 4,
        averageEventAttendance: 120,
        guestFitPercent: 60,
        eventCaptureRatePercent: 16,
        serviceHoursPerEvent: 2,
        practicalOrdersPerHour: 24,
        competingTreatsPressurePercent: 10,
        downtimePercent: 5,
        eventCostsPerEvent: 45,
        staffingTravelPerEvent: 60,
        fixedMonthlyCosts: 75,
      },
    },
  },
  {
    id: "micro-test-example",
    scenario: "micro",
    title: "Micro test example",
    description:
      "A fictional lower-volume test for small private events where basic shapes and smaller serving counts are acceptable.",
    startupCosts: {
      machine: 2200,
      importFreight: 450,
      accessoriesPayment: 250,
      deliverySetup: 225,
      openingSupplies: 200,
      localReadiness: 250,
      operatingBuffer: 350,
    },
    inputs: {
      commercial: blankCommercialPaybackInputs,
      event: {
        pricePerServing: 7,
        variableCostPerServing: 1.1,
        paymentFeePercent: 3,
        paymentFeeFlat: 0.3,
        eventsPerMonth: 3,
        averageEventAttendance: 60,
        guestFitPercent: 50,
        eventCaptureRatePercent: 22,
        serviceHoursPerEvent: 1.5,
        practicalOrdersPerHour: 18,
        competingTreatsPressurePercent: 15,
        downtimePercent: 5,
        eventCostsPerEvent: 35,
        staffingTravelPerEvent: 35,
        fixedMonthlyCosts: 50,
      },
    },
  },
];
