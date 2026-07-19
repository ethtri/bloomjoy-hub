#!/usr/bin/env node

import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:8081';
const DEFAULT_ARTIFACT_DIR = 'output/playwright';

const parseArgs = (argv) => {
  const args = {
    appUrl: process.env.OPERATOR_TIMEKEEPING_UAT_APP_URL || DEFAULT_APP_URL,
    artifactDir: process.env.OPERATOR_TIMEKEEPING_UAT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR,
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--headed') {
      args.headed = true;
      continue;
    }

    if (arg === '--app-url') {
      args.appUrl = argv[index + 1] || args.appUrl;
      index += 1;
      continue;
    }

    if (arg.startsWith('--app-url=')) {
      args.appUrl = arg.slice('--app-url='.length) || args.appUrl;
      continue;
    }

    if (arg === '--artifact-dir') {
      args.artifactDir = argv[index + 1] || args.artifactDir;
      index += 1;
      continue;
    }

    if (arg.startsWith('--artifact-dir=')) {
      args.artifactDir = arg.slice('--artifact-dir='.length) || args.artifactDir;
    }
  }

  args.appUrl = args.appUrl.replace(/\/+$/, '');
  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  return args;
};

const now = new Date();
const isoHoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

const mockUser = {
  id: '66000000-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'technician-time@example.test',
  email_confirmed_at: isoHoursAgo(24),
  confirmed_at: isoHoursAgo(24),
  last_sign_in_at: now.toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};

const mockSession = {
  access_token: 'mock-technician-time-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-technician-time-refresh-token',
  user: mockUser,
};

const profileId = '66000000-0000-4000-8000-000000000010';
const secondaryProfileId = '66000000-0000-4000-8000-000000000017';
const accountId = '66000000-0000-4000-8000-000000000011';
const periodId = '66000000-0000-4000-8000-000000000012';
const policyId = '66000000-0000-4000-8000-000000000013';
const machineId = '66000000-0000-4000-8000-000000000014';
const locationId = '66000000-0000-4000-8000-000000000015';
const workDate = '2026-05-20';
const selectedMonth = workDate.slice(0, 7);

const roundUpHour = (minutes) => Math.ceil(Math.max(minutes, 0) / 60) * 60;

const minutesForTime = (value) => {
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
};

const rawMinutes = (startTime, endTime) => minutesForTime(endTime) - minutesForTime(startTime);

const formatDateInput = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;

const getMockPeriod = (requestedWorkDate = workDate) => {
  const requestedMonth = String(requestedWorkDate || workDate).slice(0, 7);
  const [year, month] = requestedMonth.split('-').map(Number);
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  const dueDate = new Date(periodEnd);
  const lockDate = new Date(periodEnd);
  const targetPayoutDate = new Date(periodEnd);
  dueDate.setUTCDate(dueDate.getUTCDate() + 2);
  lockDate.setUTCDate(lockDate.getUTCDate() + 3);
  targetPayoutDate.setUTCDate(targetPayoutDate.getUTCDate() + 5);

  return {
    id: requestedMonth === selectedMonth ? periodId : `mock-period-${requestedMonth}`,
    periodStartDate: formatDateInput(periodStart),
    periodEndDate: formatDateInput(periodEnd),
    submissionDueDate: formatDateInput(dueDate),
    lockDate: formatDateInput(lockDate),
    targetPayoutDate: formatDateInput(targetPayoutDate),
    status: 'open',
  };
};

const entryIsInPeriod = (entry, period) =>
  entry.workDate >= period.periodStartDate && entry.workDate <= period.periodEndDate;

const buildContext = (state, requestedWorkDate = workDate) => {
  const period = getMockPeriod(requestedWorkDate);

  if (state.workerContextMode === 'setup') {
    return {
      workDate: requestedWorkDate,
      profiles: [],
    };
  }

  const assignedMachines =
    state.workerContextMode === 'no_assignments'
      ? []
      : [
          {
            assignmentId: '66000000-0000-4000-8000-000000000016',
            machineId,
            machineLabel: 'Cotton Candy 01',
            locationId,
            locationName: 'Mall Atrium',
            effectiveStartDate: '2026-01-01',
            effectiveEndDate: null,
          },
        ];
  const primaryProfile = {
      id: profileId,
      accountId,
      accountName: 'Bloomjoy UAT',
      displayName: 'Technician Time',
      workerType: 'contractor_1099',
      status: 'active',
      policy: {
        id: policyId,
        name: 'Monthly Technician pay',
        frequency: 'monthly',
        roundingRule: 'round_up_60_minutes',
        reviewModel: 'final_review_only',
      },
      currentPeriod: period,
      assignedMachines,
      currentEntries:
        state.workerContextMode === 'empty'
          ? []
          : state.entries.filter(
              (entry) => entry.status !== 'voided' && entryIsInPeriod(entry, period)
            ),
      recentEntries: state.entries.filter((entry) => entry.status !== 'voided'),
  };

  return {
    workDate: requestedWorkDate,
    profiles: [
      primaryProfile,
      {
        ...primaryProfile,
        id: secondaryProfileId,
        accountName: 'Bloomjoy UAT East',
        displayName: 'East Technician time',
        currentEntries: [],
        recentEntries: [],
      },
    ],
  };
};

const buildReviewContext = (state, requestedWorkDate = workDate) => {
  const period = getMockPeriod(requestedWorkDate);
  const hasAccess = state.reviewContextMode !== 'no_access';

  return {
    workDate: requestedWorkDate,
    periodStartDate: period.periodStartDate,
    periodEndDate: period.periodEndDate,
    hasAccess,
    machines: hasAccess
      ? [
          {
            machineId,
            machineLabel: 'Cotton Candy 01',
            locationId,
            locationName: 'Mall Atrium',
          },
        ]
      : [],
    entries:
      state.reviewContextMode === 'empty' || !hasAccess
        ? []
        : state.reviewEntries.filter((entry) => entryIsInPeriod(entry, period)),
  };
};

const makeEntry = (body, state, id = `time-entry-${state.nextEntryId++}`) => {
  const minutes = rawMinutes(body.p_start_time, body.p_end_time);

  return {
    id,
    accountId,
    operatorProfileId: profileId,
    machineId,
    machineLabel: 'Cotton Candy 01',
    locationId,
    locationName: 'Mall Atrium',
    payoutPolicyId: policyId,
    payoutPeriodId: getMockPeriod(body.p_work_date).id,
    workDate: body.p_work_date,
    startTime: body.p_start_time,
    endTime: body.p_end_time,
    rawDurationMinutes: minutes,
    roundedPaidMinutes: roundUpHour(minutes),
    notes: body.p_notes || null,
    status: body.p_status || 'submitted',
    managerReviewStatus: 'pending',
    managerReviewReason: null,
    managerReviewedAt: null,
    lockedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

const makeWorkerFixture = ({
  id,
  notes,
  startTime,
  endTime,
  status = 'submitted',
  managerReviewStatus = 'pending',
  managerReviewReason = null,
  managerReviewedAt = null,
  lockedAt = null,
}) => {
  const minutes = rawMinutes(startTime, endTime);

  return {
    id,
    accountId,
    operatorProfileId: profileId,
    machineId,
    machineLabel: 'Cotton Candy 01',
    locationId,
    locationName: 'Mall Atrium',
    payoutPolicyId: policyId,
    payoutPeriodId: periodId,
    workDate,
    startTime,
    endTime,
    rawDurationMinutes: minutes,
    roundedPaidMinutes: roundUpHour(minutes),
    notes,
    status,
    managerReviewStatus,
    managerReviewReason,
    managerReviewedAt,
    lockedAt,
    createdAt: isoHoursAgo(24),
    updatedAt: isoHoursAgo(12),
  };
};

const buildPayStatementArtifact = () => ({
  statement: {
    schemaVersion: 'operator-pay-statement-v1',
    id: '66000000-0000-4000-8000-000000000020',
    statementNumber: 'BJ-2026-05-0001',
    statementLabel: 'May 2026 Pay Statement',
    status: 'issued',
    version: 1,
    generatedAt: '2026-06-04T11:55:00.000Z',
    issuedAt: '2026-06-04T12:00:00.000Z',
    entity: {
      accountId,
      name: 'Bloomjoy UAT',
      legalName: 'Bloomjoy UAT LLC',
      contactEmail: 'ops@example.test',
      logoStoragePath: null,
      address: {
        line1: '100 Market Street',
        line2: null,
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94105',
      },
    },
    operator: {
      operatorProfileId: profileId,
      displayName: 'Technician Time',
      workerType: 'contractor_1099',
    },
    period: {
      payoutPeriodId: periodId,
      periodStartDate: '2026-05-01',
      periodEndDate: '2026-05-31',
      targetPayoutDate: '2026-06-05',
    },
    payoutRun: {
      id: '66000000-0000-4000-8000-000000000021',
      status: 'issued',
      finalizedAt: '2026-06-04T11:45:00.000Z',
      issuedAt: '2026-06-04T12:00:00.000Z',
    },
    time: {
      rawMinutes: 90,
      roundedPaidMinutes: 120,
      rawHours: 1.5,
      paidHours: 2,
      shiftCount: 2,
    },
    revenueBasis: {
      eligibleNetRevenueCents: 120000,
      commissionBasisPoints: 500,
      commissionRatePercent: 5,
    },
    totals: {
      hourlyRateCents: 2500,
      hourlyPayCents: 5000,
      commissionPayCents: 6000,
      adjustmentsTotalCents: 1450,
      totalPayoutCents: 12450,
    },
    machines: [
      {
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        rawMinutes: 90,
        roundedPaidMinutes: 120,
        paidHours: 2,
        shiftCount: 2,
        netRevenueCents: 120000,
        eligibleNetRevenueCents: 120000,
        commissionBasisPoints: 500,
        commissionPayCents: 6000,
        includedInCommissionBasis: true,
      },
    ],
    adjustments: [
      {
        id: '66000000-0000-4000-8000-000000000022',
        amountCents: 1450,
        adjustmentType: 'manual_bonus',
        description: 'Manual bonus',
        createdAt: '2026-06-04T11:50:00.000Z',
      },
    ],
    disclaimer:
      'This pay statement summarizes Bloomjoy operator payout inputs. It is not tax or payroll advice.',
    automation: {
      rawProviderPayloadsIncluded: false,
      taxComplianceEngine: false,
      payrollProviderExecution: false,
      artifactSource: 'database_payload',
    },
  },
  artifact: {
    format: 'html',
    source: 'database_payload',
    storageBucket: 'operator-pay-statements',
    storagePath: 'operators/may-2026.html',
    downloadFileName: 'may-2026-pay-statement.html',
  },
});

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const rpcErrorResponse = (message, status = 503) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    code: 'MOCK_UAT_FAILURE',
    details: null,
    hint: null,
    message,
  }),
});

const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const installMockSupabaseRoutes = async (context, state) => {
  await context.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/token')) {
      return route.fulfill(jsonResponse(mockSession));
    }

    if (url.includes('/user')) {
      return route.fulfill(jsonResponse(mockUser));
    }

    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fulfill(jsonResponse({}));
  });

  await context.route('**/rest/v1/customer_profiles**', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonResponse([]));
    }

    return route.fulfill(jsonResponse({ user_id: mockUser.id, language_preference: 'en' }));
  });

  await context.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const rpcName = new URL(url).pathname.split('/').pop() ?? '';
    const body = route.request().postDataJSON();
    state.rpcCalls.push({ rpcName, body });

    if (rpcName === 'get_my_admin_access_context') {
      return route.fulfill(
        jsonResponse({
          isSuperAdmin: false,
          isScopedAdmin: false,
          canAccessAdmin: state.managerMode,
          allowedSurfaces: state.managerMode ? ['payouts'] : [],
          scopedMachineIds: [],
        })
      );
    }

    if (rpcName === 'get_my_plus_access') {
      return route.fulfill(
        jsonResponse({
          has_plus_access: false,
          source: null,
          membership_status: null,
          current_period_end: null,
          cancel_at_period_end: false,
          paid_subscription_active: false,
          free_grant_id: null,
          free_grant_starts_at: null,
          free_grant_expires_at: null,
          free_grant_active: false,
        })
      );
    }

    if (rpcName === 'get_my_portal_access_context') {
      return route.fulfill(
        jsonResponse({
          access_tier: 'baseline',
          is_plus_member: false,
          is_training_operator: false,
          is_admin: false,
          can_manage_operator_training: false,
          is_corporate_partner: false,
          has_supply_discount: false,
          can_request_support: true,
          can_manage_technicians: false,
          capabilities: [],
          effective_presets: ['customer'],
        })
      );
    }

    if (rpcName === 'get_my_reporting_access_context') {
      return route.fulfill(
        jsonResponse({
          has_reporting_access: false,
          accessible_machine_count: 0,
          accessible_location_count: 0,
          can_manage_reporting: false,
          latest_sale_date: null,
          latest_import_completed_at: null,
        })
      );
    }

    if (rpcName === 'resolve_my_technician_entitlements') {
      return route.fulfill(
        jsonResponse({
          technicianEmail: mockUser.email,
          resolvedGrantCount: 0,
          resolvedOperatorTrainingGrantCount: 0,
          upsertedReportingEntitlementCount: 0,
          skippedGrantCount: 0,
        })
      );
    }

    if (rpcName === 'get_my_operator_timekeeping_context') {
      const requestedWorkerDate =
        typeof body?.p_work_date === 'string' ? body.p_work_date : workDate;
      const isWorkerPageRequest = typeof body?.p_work_date === 'string';
      if (isWorkerPageRequest && state.workerLoadDelayMs > 0) {
        await wait(state.workerLoadDelayMs);
      }
      if (isWorkerPageRequest && state.workerLoadError) {
        return route.fulfill(rpcErrorResponse('Mock worker timekeeping load failed.'));
      }
      return route.fulfill(jsonResponse(buildContext(state, requestedWorkerDate)));
    }

    if (rpcName === 'get_my_time_review_context') {
      if (state.reviewLoadDelayMs > 0) {
        await wait(state.reviewLoadDelayMs);
      }
      if (state.reviewLoadError) {
        return route.fulfill(rpcErrorResponse('Mock manager review load failed.'));
      }
      return route.fulfill(jsonResponse(buildReviewContext(state, body?.p_work_date ?? workDate)));
    }

    if (rpcName === 'review_operator_time_entry') {
      if (state.failNextReview) {
        state.failNextReview = false;
        return route.fulfill(rpcErrorResponse('Mock review save failed. Try again.', 500));
      }
      state.reviewEntries = state.reviewEntries.map((entry) =>
        entry.id === body.p_time_entry_id
          ? {
              ...entry,
              managerReviewStatus: body.p_decision,
              managerReviewReason: body.p_reason || null,
              managerReviewedAt: now.toISOString(),
              updatedAt: now.toISOString(),
            }
          : entry
      );
      return route.fulfill(
        jsonResponse({
          timeEntry: state.reviewEntries.find((entry) => entry.id === body.p_time_entry_id),
          context: buildReviewContext(state, body?.p_work_date ?? workDate),
        })
      );
    }

    if (rpcName === 'get_my_operator_pay_statement_context') {
      return route.fulfill(
        jsonResponse({
          profiles: [
            {
              id: profileId,
              accountId,
              accountName: 'Bloomjoy UAT',
              displayName: 'Technician Time',
              workerType: 'contractor_1099',
              statements: [
                {
                  id: '66000000-0000-4000-8000-000000000020',
                  statementNumber: 'BJ-2026-05-0001',
                  statementLabel: 'May 2026 Pay Statement',
                  status: 'issued',
                  version: 1,
                  issuedAt: '2026-06-04T12:00:00.000Z',
                  storageBucket: 'operator-pay-statements',
                  storagePath: 'operators/may-2026.html',
                  totalPayoutCents: 12450,
                  periodStartDate: '2026-05-01',
                  periodEndDate: '2026-05-31',
                  notificationStatus: 'portal_published',
                  targetPayoutDate: '2026-06-05',
                  revisionCount: 0,
                  downloadFileName: 'may-2026-pay-statement.html',
                },
              ],
            },
          ],
        })
      );
    }

    if (rpcName === 'get_pay_statement_artifact') {
      return route.fulfill(jsonResponse(buildPayStatementArtifact()));
    }

    if (rpcName === 'submit_operator_time_entry') {
      if (state.failNextSubmit) {
        state.failNextSubmit = false;
        return route.fulfill(rpcErrorResponse('Mock shift save failed. Try again.', 500));
      }
      const entry = makeEntry(body, state);
      state.entries.push(entry);
      return route.fulfill(
        jsonResponse({
          timeEntry: entry,
          context: buildContext(state, body?.p_work_date ?? workDate),
        })
      );
    }

    if (rpcName === 'update_operator_time_entry') {
      const index = state.entries.findIndex((entry) => entry.id === body.p_time_entry_id);
      if (index !== -1) {
        state.entries[index] = makeEntry(body, state, body.p_time_entry_id);
      }
      return route.fulfill(
        jsonResponse({
          timeEntry: state.entries[index],
          context: buildContext(state, body?.p_work_date ?? workDate),
        })
      );
    }

    if (rpcName === 'void_operator_time_entry') {
      const voidedEntry = state.entries.find((entry) => entry.id === body.p_time_entry_id);
      state.entries = state.entries.map((entry) =>
        entry.id === body.p_time_entry_id ? { ...entry, status: 'voided' } : entry
      );
      return route.fulfill(
        jsonResponse({
          timeEntryId: body.p_time_entry_id,
          context: buildContext(state, voidedEntry?.workDate ?? workDate),
        })
      );
    }

    return route.fulfill(jsonResponse({}));
  });
};

const waitForServer = async (appUrl) => {
  try {
    const response = await fetch(appUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `Unable to reach ${appUrl}. Start the app first, for example: npm run dev -- --host 127.0.0.1 --port 8081 --strictPort. ${error.message}`
    );
  }
};

const waitForCondition = async (predicate, message, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(message);
};

const createRecorder = () => {
  const results = [];

  return {
    pass(name, detail = '') {
      results.push({ name, pass: true, detail });
      console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
    },
    fail(name, detail = '') {
      results.push({ name, pass: false, detail });
      console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    },
    assert(name, condition, detail = '') {
      if (condition) {
        this.pass(name, detail);
      } else {
        this.fail(name, detail);
      }
    },
    failed() {
      return results.filter((result) => !result.pass);
    },
  };
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const recorder = createRecorder();
  const state = {
    managerMode: false,
    workerContextMode: 'normal',
    reviewContextMode: 'normal',
    workerLoadDelayMs: 0,
    reviewLoadDelayMs: 0,
    workerLoadError: false,
    reviewLoadError: false,
    failNextSubmit: false,
    failNextReview: false,
    entries: [
      {
        id: 'time-entry-past',
        accountId,
        operatorProfileId: profileId,
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: '66000000-0000-4000-8000-000000000030',
        workDate: '2026-04-20',
        startTime: '12:00',
        endTime: '14:15',
        rawDurationMinutes: 135,
        roundedPaidMinutes: 180,
        notes: 'April payout close.',
        status: 'paid',
        managerReviewStatus: 'approved',
        managerReviewReason: null,
        managerReviewedAt: isoHoursAgo(73),
        lockedAt: isoHoursAgo(72),
        createdAt: isoHoursAgo(96),
        updatedAt: isoHoursAgo(72),
      },
      makeWorkerFixture({
        id: 'time-entry-worker-pending',
        notes: 'Pending shift for manager review.',
        startTime: '08:00',
        endTime: '09:15',
      }),
      makeWorkerFixture({
        id: 'time-entry-worker-approved',
        notes: 'Approved shift ready for edit-reset QA.',
        startTime: '10:00',
        endTime: '11:30',
        managerReviewStatus: 'approved',
        managerReviewedAt: isoHoursAgo(8),
      }),
      makeWorkerFixture({
        id: 'time-entry-worker-correction',
        notes: 'Correction shift needs an updated end time.',
        startTime: '12:00',
        endTime: '13:10',
        managerReviewStatus: 'needs_correction',
        managerReviewReason: 'Please update the end time to match the venue log.',
        managerReviewedAt: isoHoursAgo(6),
      }),
      makeWorkerFixture({
        id: 'time-entry-worker-included',
        notes: 'Included shift cannot be changed.',
        startTime: '14:00',
        endTime: '15:20',
        status: 'included_in_payout',
        managerReviewStatus: 'approved',
        managerReviewedAt: isoHoursAgo(5),
        lockedAt: isoHoursAgo(4),
      }),
      makeWorkerFixture({
        id: 'time-entry-worker-paid',
        notes: 'Paid shift cannot be changed.',
        startTime: '16:00',
        endTime: '17:10',
        status: 'paid',
        managerReviewStatus: 'approved',
        managerReviewedAt: isoHoursAgo(4),
        lockedAt: isoHoursAgo(3),
      }),
      makeWorkerFixture({
        id: 'time-entry-worker-locked',
        notes: 'Locked shift cannot be changed.',
        startTime: '18:00',
        endTime: '19:05',
        status: 'locked',
        lockedAt: isoHoursAgo(2),
      }),
    ],
    reviewEntries: [
      {
        id: 'time-entry-manager-approve',
        accountId,
        accountName: 'Bloomjoy UAT',
        operatorProfileId: '66000000-0000-4000-8000-000000000040',
        operatorName: 'Jordan Contractor',
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: periodId,
        workDate: '2026-05-19',
        startTime: '09:00',
        endTime: '12:30',
        rawDurationMinutes: 210,
        roundedPaidMinutes: 240,
        notes: 'Morning service and cleanup.',
        status: 'submitted',
        managerReviewStatus: 'pending',
        managerReviewReason: null,
        managerReviewedAt: null,
        lockedAt: null,
        createdAt: isoHoursAgo(30),
        updatedAt: isoHoursAgo(30),
      },
      {
        id: 'time-entry-manager-correction',
        accountId,
        accountName: 'Bloomjoy UAT',
        operatorProfileId: '66000000-0000-4000-8000-000000000041',
        operatorName: 'Sam Contractor',
        machineId,
        machineLabel: 'Cotton Candy 01',
        locationId,
        locationName: 'Mall Atrium',
        payoutPolicyId: policyId,
        payoutPeriodId: periodId,
        workDate: '2026-05-20',
        startTime: '13:00',
        endTime: '15:10',
        rawDurationMinutes: 130,
        roundedPaidMinutes: 180,
        notes: null,
        status: 'submitted',
        managerReviewStatus: 'pending',
        managerReviewReason: null,
        managerReviewedAt: null,
        lockedAt: null,
        createdAt: isoHoursAgo(20),
        updatedAt: isoHoursAgo(20),
      },
    ],
    nextEntryId: 1,
    rpcCalls: [],
  };

  await mkdir(args.artifactDir, { recursive: true });
  await waitForServer(args.appUrl);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1365, height: 900 },
  });
  await installMockSupabaseRoutes(context, state);

  const page = await context.newPage();
  const consoleErrors = [];
  const desktopViewport = { width: 1365, height: 900 };

  const capture390State = async (screenshotName, assertionLabel) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[role="dialog"]').evaluateAll(async (dialogs) => {
      const animations = dialogs.flatMap((dialog) =>
        dialog.getAnimations({ subtree: true })
      );
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );
    const hasOverflow = await page.evaluate(() => {
      const documentOverflows = document.documentElement.scrollWidth > window.innerWidth + 1;
      const dialogOverflows = [...document.querySelectorAll('[role="dialog"]')].some((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      });

      return documentOverflows || dialogOverflows;
    });
    recorder.assert(`390px ${assertionLabel} has no horizontal overflow`, !hasOverflow);
    await page.screenshot({
      path: path.join(args.artifactDir, screenshotName),
      fullPage: true,
    });
    await page.setViewportSize(desktopViewport);
  };

  const readContrast = async (locator) =>
    locator.evaluate((element) => {
      const parseColor = (value) => {
        const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return {
          red: channels[0] ?? 0,
          green: channels[1] ?? 0,
          blue: channels[2] ?? 0,
          alpha: channels[3] ?? 1,
        };
      };
      const composite = (foreground, background) => ({
        red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
        green:
          foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
        blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
        alpha: 1,
      });
      const layers = [];
      let node = element;
      while (node instanceof Element) {
        layers.push(parseColor(getComputedStyle(node).backgroundColor));
        node = node.parentElement;
      }
      const background = layers
        .reverse()
        .reduce(
          (currentBackground, layer) => composite(layer, currentBackground),
          { red: 255, green: 255, blue: 255, alpha: 1 }
        );
      const foreground = composite(parseColor(getComputedStyle(element).color), background);
      const luminance = (color) =>
        [color.red, color.green, color.blue]
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4
          )
          .reduce(
            (total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index],
            0
          );
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);

      return {
        ratio:
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      };
    });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${args.appUrl}/portal/time?month=${selectedMonth}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForURL('**/login', { timeout: 10000 }).catch(() => undefined);
    await page.waitForSelector('#email-password', { timeout: 10000 });
    await page.fill('#email-password', mockUser.email);
    await page.fill('#password', 'mock-password');
    await Promise.all([
      page.waitForURL(/\/portal\/time\?month=2026-05$/, { timeout: 20000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    await page.locator('h1').filter({ hasText: /^Time$/ }).waitFor({ timeout: 10000 });
    await page.getByRole('link', { name: /add completed shift/i }).waitFor({ timeout: 10000 });

    recorder.assert('Portal Time route loads after auth', new URL(page.url()).pathname === '/portal/time', page.url());
    recorder.assert(
      'Portal access probe sends a null date instead of React Query context',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'get_my_operator_timekeeping_context' &&
          call.body?.p_work_date === null
      ) &&
        !state.rpcCalls.some(
          (call) =>
            call.rpcName === 'get_my_operator_timekeeping_context' &&
            typeof call.body?.p_work_date === 'object' &&
            call.body?.p_work_date !== null
        )
    );
    recorder.assert(
      'Time hub keeps data entry out of the dashboard',
      (await page.locator('#work-date').count()) === 0
    );
    recorder.assert(
      'Monthly hub shows the primary entry action and month control',
      (await page.getByRole('link', { name: /add completed shift/i }).isVisible()) &&
        (await page.locator('#time-month').isVisible()) &&
        (await page.getByLabel('Work profile').isVisible())
    );
    recorder.assert(
      'Fixed-period mock keeps selected month, date range, and due date aligned',
      (await page.locator('#time-month').inputValue()) === selectedMonth &&
        (await page.getByRole('heading', { name: 'May 2026 shifts' }).isVisible()) &&
        (await page
          .getByText('May 1, 2026 to May 31, 2026', { exact: true })
          .first()
          .isVisible()) &&
        (await page.getByText(/Due Jun 2, 2026\./).isVisible())
    );
    recorder.assert(
      'Worker summary shows submitted-shift count',
      await page
        .locator('span')
        .filter({ hasText: /submitted shifts/i })
        .getByText('3', { exact: true })
        .isVisible()
    );

    const workerStatusCases = [
      ['Pending shift for manager review.', 'Waiting for review', false],
      ['Approved shift ready for edit-reset QA.', 'Approved', false],
      ['Correction shift needs an updated end time.', 'Correction requested', false],
      ['Included shift cannot be changed.', 'Included in pay', true],
      ['Paid shift cannot be changed.', 'Paid', true],
      ['Locked shift cannot be changed.', 'Locked', true],
    ];
    for (const [note, status, shouldBeLocked] of workerStatusCases) {
      const entry = page.locator('article', { hasText: note });
      recorder.assert(
        `Worker ${status} state is visible`,
        (await entry.getByText(status, { exact: true }).isVisible()) &&
          (!shouldBeLocked ||
            ((await entry.getByRole('button', { name: /edit/i }).isDisabled()) &&
              (await entry.getByRole('button', { name: /delete/i }).isDisabled())))
      );
    }
    const pendingWorkerEntry = page.locator('article', {
      hasText: 'Pending shift for manager review.',
    });
    recorder.assert(
      'Repeated worker actions include shift context in their accessible names',
      (await pendingWorkerEntry
        .getByRole('button', {
          name: /Edit shift on May 20, 2026, 08:00 to 09:15, Cotton Candy 01 - Mall Atrium/i,
        })
        .isVisible()) &&
        (await pendingWorkerEntry
          .getByRole('button', {
            name: /Delete shift on May 20, 2026, 08:00 to 09:15, Cotton Candy 01 - Mall Atrium/i,
          })
          .isVisible())
    );
    recorder.assert(
      'Worker correction state includes manager reason',
      await page
        .getByText('Please update the end time to match the venue log.', { exact: true })
        .isVisible()
    );
    const contrastBadgeLabels = [
      'Correction requested',
      'Approved',
      'Included in pay',
      'Paid',
      'Locked',
    ];
    for (const theme of ['light', 'dark']) {
      await page.evaluate((nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
      }, theme);
      await page.waitForTimeout(50);
      for (const label of contrastBadgeLabels) {
        const result = await readContrast(
          page.locator(`[data-time-status-badge="${label}"]`).first()
        );
        recorder.assert(
          `${theme} ${label} 12px badge meets WCAG AA normal-text contrast`,
          result.fontSize === 12 && result.ratio >= 4.5,
          `${result.ratio.toFixed(2)}:1 at ${result.fontSize}px`
        );
      }
    }
    await capture390State(
      'portal-time-worker-status-badges-dark-mobile.png',
      'dark worker status-badge page'
    );
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    recorder.assert(
      'Pay statement download is visible',
      (await page.getByRole('heading', { name: 'Pay Statements' }).isVisible()) &&
        (await page.getByRole('button', { name: /download pay statement/i }).isVisible())
    );
    recorder.assert(
      'Technician-facing pay statement copy uses approved terminology',
      await page.getByText('May 2026 Pay Statement').isVisible()
    );
    const payStatementDownloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download pay statement/i }).click();
    const payStatementDownload = await payStatementDownloadPromise;
    await waitForCondition(
      () => state.rpcCalls.some((call) => call.rpcName === 'get_pay_statement_artifact'),
      'Timed out waiting for get_pay_statement_artifact RPC'
    );
    await page.getByText('Pay statement downloaded.').last().waitFor({ timeout: 10000 });
    const payStatementDownloadPath = await payStatementDownload.path();
    const downloadedPayStatementHtml = payStatementDownloadPath
      ? await readFile(payStatementDownloadPath, 'utf8')
      : '';
    recorder.assert(
      'Pay statement download loads artifact payload',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'get_pay_statement_artifact' &&
          call.body?.p_pay_statement_id === '66000000-0000-4000-8000-000000000020'
      )
    );
    recorder.assert(
      'Downloaded pay statement HTML uses approved terminology',
      downloadedPayStatementHtml.includes('May 2026 Pay Statement') &&
        downloadedPayStatementHtml.includes('>Technician<') &&
        downloadedPayStatementHtml.includes('>Total Technician pay<') &&
        downloadedPayStatementHtml.includes(
          'This pay statement summarizes Bloomjoy Technician pay inputs'
        ) &&
        payStatementDownload.suggestedFilename() === 'may-2026-pay-statement.html'
    );
    await page
      .getByText('Pay statement downloaded.', { exact: true })
      .last()
      .waitFor({ state: 'hidden', timeout: 10000 });
    recorder.assert(
      'Worker review summary is visible',
      (await page.getByRole('heading', { name: 'Record completed work' }).isVisible()) &&
        (await page.locator('#time-month').isVisible())
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-worker-states-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-worker-states-mobile.png',
      'worker state-rich monthly hub'
    );

    state.workerLoadDelayMs = 4000;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Loading timekeeping...', { exact: true }).waitFor({ timeout: 5000 });
    recorder.assert(
      'Worker loading state is exclusive',
      (await page.getByText('Timekeeping is unavailable', { exact: true }).count()) === 0 &&
        (await page.getByText('Timekeeping setup needed', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-loading-desktop.png'),
      fullPage: true,
    });
    await capture390State('portal-time-loading-mobile.png', 'worker loading state');
    state.workerLoadDelayMs = 0;
    await page.getByRole('heading', { name: 'Record completed work' }).waitFor({ timeout: 10000 });

    state.workerLoadError = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page
      .getByText('Timekeeping is unavailable', { exact: true })
      .waitFor({ timeout: 10000 });
    recorder.assert(
      'Worker load error is exclusive and actionable',
      (await page.getByRole('button', { name: 'Try again' }).isVisible()) &&
        (await page.getByRole('heading', { name: 'Record completed work' }).count()) === 0 &&
        (await page.getByText('Timekeeping setup needed', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-load-error-desktop.png'),
      fullPage: true,
    });
    await capture390State('portal-time-load-error-mobile.png', 'worker load-error state');
    state.workerLoadError = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Record completed work' }).waitFor({ timeout: 10000 });
    recorder.pass('Worker load retry restores the monthly hub');

    state.workerContextMode = 'no_assignments';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Timekeeping setup needed', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Worker setup state explains assignment recovery without showing an empty shift list',
      (await page.getByText(/assign at least one machine/i).isVisible()) &&
        (await page.getByRole('button', { name: 'Check setup again' }).isVisible()) &&
        (await page.getByText(/No shifts entered for this month yet/i).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-setup-desktop.png'),
      fullPage: true,
    });
    await capture390State('portal-time-setup-mobile.png', 'worker setup state');
    state.workerContextMode = 'normal';
    await page.getByRole('button', { name: 'Check setup again' }).click();
    await page.getByRole('heading', { name: 'Record completed work' }).waitFor({ timeout: 10000 });
    recorder.pass('Worker setup recovery restores the monthly hub');

    state.workerContextMode = 'empty';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(/No shifts entered for this month yet/i).waitFor({ timeout: 10000 });
    recorder.assert(
      'Worker empty state stays distinct from setup and load failure',
      (await page.getByRole('link', { name: /add completed shift/i }).isVisible()) &&
        (await page.getByText('Timekeeping setup needed', { exact: true }).count()) === 0 &&
        (await page.getByText('Timekeeping is unavailable', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-empty-desktop.png'),
      fullPage: true,
    });
    await capture390State('portal-time-empty-mobile.png', 'worker empty state');
    state.workerContextMode = 'normal';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByText('Pending shift for manager review.', { exact: true }).waitFor({
      timeout: 10000,
    });

    const editAndAssertReviewReset = async ({
      sourceNote,
      nextNote,
      endTime,
      screenshotName,
      expectedCorrectionReason,
    }) => {
      const sourceEntry = page.locator('article', { hasText: sourceNote });
      await sourceEntry.getByRole('button', { name: /edit/i }).click();
      await page.locator('h1').filter({ hasText: /^Edit Time$/ }).waitFor({ timeout: 10000 });
      recorder.assert(
        'Focused Edit Time associates the multi-profile select with its visible label',
        await page.getByLabel('Technician pay profile').isVisible()
      );
      if (expectedCorrectionReason) {
        recorder.assert(
          'Focused Edit Time keeps the manager correction reason visible',
          (await page
            .getByRole('note')
            .getByText(expectedCorrectionReason, { exact: true })
            .isVisible()) &&
            (await page
              .getByRole('note')
              .getByText('Your manager requested a correction', { exact: true })
              .isVisible())
        );
      }
      if (screenshotName) {
        await capture390State(screenshotName, 'focused Edit Time correction state');
      }
      await page.fill('#end-time', endTime);
      await page.fill('#time-notes', nextNote);
      await page.getByRole('button', { name: /save changes/i }).click();
      await page.waitForURL(/\/portal\/time\?month=2026-05$/, { timeout: 10000 });
      await page.getByText('Time entry saved.').last().waitFor({ timeout: 10000 });
      const updatedEntry = page.locator('article', { hasText: nextNote });
      await updatedEntry.getByText('Waiting for review', { exact: true }).waitFor({
        timeout: 10000,
      });
      return updatedEntry;
    };

    const correctedEntry = await editAndAssertReviewReset({
      sourceNote: 'Correction shift needs an updated end time.',
      nextNote: 'Corrected shift after manager note.',
      endTime: '13:25',
      screenshotName: 'portal-time-correction-edit-mobile.png',
      expectedCorrectionReason: 'Please update the end time to match the venue log.',
    });
    recorder.assert(
      'Editing a correction-requested shift resets review and clears the old reason',
      (await correctedEntry.getByText('Waiting for review', { exact: true }).isVisible()) &&
        (await correctedEntry
          .getByText('Please update the end time to match the venue log.', { exact: true })
          .count()) === 0
    );

    const approvedEntry = await editAndAssertReviewReset({
      sourceNote: 'Approved shift ready for edit-reset QA.',
      nextNote: 'Approved shift updated by worker.',
      endTime: '11:40',
    });
    recorder.assert(
      'Editing an approved shift resets review to pending',
      await approvedEntry.getByText('Waiting for review', { exact: true }).isVisible()
    );
    recorder.assert(
      'Edit reset uses audited update RPC',
      state.rpcCalls.filter((call) => call.rpcName === 'update_operator_time_entry').length >= 2
    );

    await Promise.all([
      page.waitForURL(/\/portal\/time\/new\?month=2026-05$/, { timeout: 10000 }),
      page.getByRole('link', { name: /add completed shift/i }).click(),
    ]);
    await page.locator('h1').filter({ hasText: /^Add Time$/ }).waitFor({ timeout: 10000 });
    await page.getByText(/Cotton Candy 01/).first().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-add-desktop.png'),
      fullPage: true,
    });

    recorder.assert('Focused Add Time route loads', new URL(page.url()).pathname === '/portal/time/new', page.url());
    recorder.assert(
      'Assigned machine is visible on focused Add Time route',
      await page.getByText(/Cotton Candy 01/).first().isVisible()
    );
    recorder.assert(
      'Focused Add Time keeps the selected mock period',
      (await page.locator('#work-date').inputValue()) === '2026-05-01' &&
        (await page.getByText('May 1, 2026 to May 31, 2026', { exact: true }).isVisible()) &&
        (await page.getByText('Jun 2, 2026', { exact: true }).isVisible())
    );

    await page.fill('#work-date', workDate);
    await page.fill('#start-time', '20:30');
    await page.fill('#end-time', '21:00');
    await page.fill('#time-notes', 'Restocked sugar and cleaned spinner head.');

    recorder.assert('Actual time preview updates', await page.getByText('30 min').isVisible());
    recorder.assert(
      'Rounded-time preview rounds to full hour',
      await page.getByText('1 rounded hr').isVisible()
    );

    state.failNextSubmit = true;
    await page.getByRole('button', { name: /submit shift/i }).click();
    await page.getByText('Shift was not saved', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Worker mutation failure preserves form for retry',
      new URL(page.url()).pathname === '/portal/time/new' &&
        (await page.locator('#time-notes').inputValue()) ===
          'Restocked sugar and cleaned spinner head.' &&
        (await page.locator('#start-time').inputValue()) === '20:30'
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-mutation-error-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-mutation-error-mobile.png',
      'worker mutation-failure state'
    );
    await page.getByRole('button', { name: /submit shift/i }).click();
    await page.waitForURL(/\/portal\/time\?month=2026-05$/, { timeout: 10000 });
    await page.getByText('Time entry saved.').last().waitFor({ timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-after-save.png'),
      fullPage: true,
    });
    await page.getByText('Restocked sugar and cleaned spinner head.').waitFor({ timeout: 10000 });
    await page
      .locator('article', { hasText: 'Restocked sugar and cleaned spinner head.' })
      .getByText('Waiting for review', { exact: true })
      .waitFor({ timeout: 10000 });

    recorder.assert(
      'Worker mutation retry submits assigned machine and date',
      state.rpcCalls.filter(
        (call) =>
          call.rpcName === 'submit_operator_time_entry' &&
          call.body?.p_reporting_machine_id === machineId &&
          call.body?.p_work_date === workDate
      ).length === 2
    );

    await Promise.all([
      page.waitForURL(/\/portal\/time\/new\?month=2026-05$/, { timeout: 10000 }),
      page.getByRole('link', { name: /add completed shift/i }).click(),
    ]);
    await page.fill('#work-date', workDate);
    await page.fill('#start-time', '20:30');
    await page.fill('#end-time', '21:00');
    await page.getByText(/duplicate of an existing shift/i).waitFor({ timeout: 10000 });
    recorder.assert(
      'Exact duplicate blocks save',
      await page.getByRole('button', { name: /submit shift/i }).isDisabled()
    );

    await page.fill('#start-time', '20:45');
    await page.fill('#end-time', '21:15');
    await page.getByText(/overlaps 1 existing entry/i).waitFor({ timeout: 10000 });
    recorder.pass('Overlap warning appears before saving');
    let sawOverlapConfirmation = false;
    page.once('dialog', async (dialog) => {
      sawOverlapConfirmation = dialog.message().includes('overlaps 1 existing entry');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: /submit shift/i }).click();
    await waitForCondition(
      () => sawOverlapConfirmation,
      'Timed out waiting for overlap confirmation dialog'
    );
    recorder.assert(
      'Overlap save requires explicit confirmation',
      sawOverlapConfirmation && new URL(page.url()).pathname === '/portal/time/new'
    );

    await page.fill('#work-date', '2026-05-21');
    await page.fill('#start-time', '08:00');
    await page.fill('#end-time', '20:00');
    await page.getByText(/10\+ hours/i).waitFor({ timeout: 10000 });
    recorder.pass('Long-shift warning appears before saving');
    let sawLongShiftConfirmation = false;
    page.once('dialog', async (dialog) => {
      sawLongShiftConfirmation = dialog.message().includes('10+ hours');
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: /submit shift/i }).click();
    await waitForCondition(
      () => sawLongShiftConfirmation,
      'Timed out waiting for long-shift confirmation dialog'
    );
    recorder.assert(
      'Long shift save requires explicit confirmation',
      sawLongShiftConfirmation && new URL(page.url()).pathname === '/portal/time/new'
    );

    await capture390State('portal-time-add-mobile.png', 'Add Time validation state');
    await page.getByRole('link', { name: /time home/i }).click();
    await page.waitForURL(/\/portal\/time\?month=2026-05$/, { timeout: 10000 });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page
      .locator('article', { hasText: 'Restocked sugar and cleaned spinner head.' })
      .getByRole('button', { name: /delete/i })
      .click();
    await page.getByText('Time entry deleted.').last().waitFor({ timeout: 10000 });

    recorder.assert(
      'Delete uses void RPC instead of direct hard delete',
      state.rpcCalls.some((call) => call.rpcName === 'void_operator_time_entry')
    );

    state.managerMode = true;
    state.reviewLoadDelayMs = 4000;
    await page.setViewportSize(desktopViewport);
    await page.goto(`${args.appUrl}/portal/time-review`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Loading submitted time...', { exact: true }).waitFor({ timeout: 5000 });
    recorder.assert(
      'Manager loading state is exclusive',
      (await page.getByText('Time review is unavailable', { exact: true }).count()) === 0 &&
        (await page.getByText('No managed machines', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-loading-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-review-loading-mobile.png',
      'manager loading state'
    );
    state.reviewLoadDelayMs = 0;
    await page.locator('#review-month').waitFor({ timeout: 10000 });

    state.reviewLoadError = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Time review is unavailable', { exact: true }).waitFor({
      timeout: 30000,
    });
    recorder.assert(
      'Manager load error is exclusive and actionable',
      (await page.getByRole('button', { name: 'Try again' }).isVisible()) &&
        (await page.locator('#review-month').count()) === 0 &&
        (await page.getByText('No managed machines', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-load-error-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-review-load-error-mobile.png',
      'manager load-error state'
    );
    state.reviewLoadError = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('#review-month').waitFor({ timeout: 10000 });
    recorder.pass('Manager load retry restores review controls');

    state.reviewContextMode = 'no_access';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('No managed machines', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Manager setup state explains assignment recovery without showing the queue',
      (await page.getByText(/update your machine assignment/i).isVisible()) &&
        (await page.locator('#review-month').count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-no-access-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-review-no-access-mobile.png',
      'manager no-access state'
    );
    state.reviewContextMode = 'normal';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.locator('#review-month').waitFor({ timeout: 10000 });
    recorder.pass('Manager setup refresh restores review controls');

    state.reviewContextMode = 'empty';
    await page.fill('#review-month', selectedMonth);
    await page.getByText('Nothing waiting for review', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Manager empty queue stays distinct from setup and load failure',
      (await page.getByText(/caught up for this month/i).isVisible()) &&
        (await page.getByText('No managed machines', { exact: true }).count()) === 0 &&
        (await page.getByText('Time review is unavailable', { exact: true }).count()) === 0
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-empty-desktop.png'),
      fullPage: true,
    });
    await capture390State('portal-time-review-empty-mobile.png', 'manager empty-queue state');
    state.reviewContextMode = 'normal';
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByText('Jordan Contractor', { exact: true }).waitFor({ timeout: 10000 });

    recorder.assert(
      'Manager fixed-period evidence matches the selected month',
      (await page.locator('#review-month').inputValue()) === selectedMonth &&
        (await page.getByText('May 1, 2026 to May 31, 2026', { exact: true }).isVisible())
    );
    recorder.assert(
      'Machine Manager review queue loads managed-machine shifts',
      (await page.getByText('Jordan Contractor', { exact: true }).isVisible()) &&
        (await page.getByText('Sam Contractor', { exact: true }).isVisible()) &&
        (await page.getByText(/Cotton Candy 01.*Mall Atrium/).first().isVisible())
    );

    state.failNextReview = true;
    const jordanEntry = page.locator('article', { hasText: 'Jordan Contractor' });
    const jordanApproveButton = jordanEntry.getByRole('button', {
      name: /^Approve Jordan Contractor's shift on May 19, 2026/i,
    });
    recorder.assert(
      'Repeated manager actions include shift context in their accessible names',
      (await jordanApproveButton.isVisible()) &&
        (await page
          .locator('article', { hasText: 'Sam Contractor' })
          .getByRole('button', {
            name: /^Request correction for Sam Contractor's shift on May 20, 2026/i,
          })
          .isVisible())
    );
    await jordanApproveButton.click();
    await page.getByText('Review was not saved', { exact: true }).waitFor({ timeout: 10000 });
    recorder.assert(
      'Manager mutation failure keeps the shift actionable for retry',
      (await jordanApproveButton.isEnabled()) &&
        state.reviewEntries.find((entry) => entry.id === 'time-entry-manager-approve')
          ?.managerReviewStatus === 'pending'
    );
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-mutation-error-desktop.png'),
      fullPage: true,
    });
    await capture390State(
      'portal-time-review-mutation-error-mobile.png',
      'manager mutation-failure state'
    );
    await jordanApproveButton.click();
    await page.getByText('Shift approved.').last().waitFor({ timeout: 10000 });
    const queueFocusedAfterApprove = await page
      .waitForFunction(
        () => document.activeElement?.id === 'time-review-queue-heading',
        undefined,
        { timeout: 5000 }
      )
      .then(() => true)
      .catch(() => false);
    recorder.assert(
      'Approve retry uses the machine-manager review RPC',
      state.rpcCalls.filter(
        (call) =>
          call.rpcName === 'review_operator_time_entry' &&
          call.body?.p_time_entry_id === 'time-entry-manager-approve' &&
          call.body?.p_decision === 'approved'
      ).length === 2
    );
    recorder.assert(
      'Successful approve moves keyboard focus to the live review queue heading',
      queueFocusedAfterApprove &&
        (await page
          .getByText('Shift approved. The review queue is updated.', { exact: true })
          .isVisible())
    );
    await page
      .getByText('Shift approved.', { exact: true })
      .last()
      .waitFor({ state: 'hidden', timeout: 10000 });

    const samEntry = page.locator('article', { hasText: 'Sam Contractor' });
    await samEntry
      .getByRole('button', {
        name: /^Request correction for Sam Contractor's shift on May 20, 2026/i,
      })
      .click();
    await page.getByRole('dialog').waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await capture390State(
      'portal-time-review-correction-dialog-mobile.png',
      'manager correction-dialog state'
    );
    await page.fill('#correction-reason', 'Please confirm the end time; the venue log shows 2:45 PM.');
    await page.getByRole('button', { name: /send correction request/i }).click();
    await page.getByText('Correction requested.').last().waitFor({ timeout: 10000 });
    const queueFocusedAfterCorrection = await page
      .waitForFunction(
        () => document.activeElement?.id === 'time-review-queue-heading',
        undefined,
        { timeout: 5000 }
      )
      .then(() => true)
      .catch(() => false);
    recorder.assert(
      'Correction action sends a required worker-visible reason',
      state.rpcCalls.some(
        (call) =>
          call.rpcName === 'review_operator_time_entry' &&
          call.body?.p_time_entry_id === 'time-entry-manager-correction' &&
          call.body?.p_decision === 'needs_correction' &&
          call.body?.p_reason === 'Please confirm the end time; the venue log shows 2:45 PM.'
      )
    );
    recorder.assert(
      'Successful correction moves keyboard focus to the live review queue heading',
      queueFocusedAfterCorrection &&
        (await page
          .getByText('Correction requested. The review queue is updated.', { exact: true })
          .isVisible())
    );

    await page.getByRole('button', { name: /Returned \(1\)/i }).click();
    await page
      .getByText('Please confirm the end time; the venue log shows 2:45 PM.')
      .waitFor({ timeout: 10000 });
    await page
      .getByText('Correction requested.', { exact: true })
      .last()
      .waitFor({ state: 'hidden', timeout: 10000 });
    await page.screenshot({
      path: path.join(args.artifactDir, 'portal-time-review-desktop.png'),
      fullPage: true,
    });

    await capture390State('portal-time-review-mobile.png', 'manager returned-shift queue');

    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) => !/status of (500|503)/i.test(message)
    );
    recorder.assert(
      'No unexpected browser console/page errors during mocked Technician Time QA pass',
      unexpectedConsoleErrors.length === 0,
      unexpectedConsoleErrors.slice(0, 3).join(' | ')
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = recorder.failed();
  if (failed.length > 0) {
    console.error(`\nTechnician Time UAT validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nTechnician Time UAT validation passed.');
  console.log(`Screenshots written to ${args.artifactDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
