import { closeRefundPortalContext, navigateRefundPortalPage } from '../../refund-portal-uat-lifecycle.mjs';

const jsonResponse = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export const runPublicRefundSubmissionJourney = async ({ browser, appUrl, recorder, labelReadOnlyRpc }) => {
  const selectionKey = 'b'.repeat(64);
  const emailContextToken = 'a'.repeat(43);
  const journeys = [
    { name: 'direct', path: '/refunds/request', expectedEmailContextToken: undefined },
    { name: 'email-linked', path: `/refunds/request?emailContext=${emailContextToken}`, expectedEmailContextToken: emailContextToken },
  ];

  for (const journey of journeys) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const submissions = [];
    await context.route('**/rest/v1/rpc/public_refund_selections_v2', async (route) => {
      labelReadOnlyRpc(route, 'public_refund_selections_v2');
      await route.fulfill(jsonResponse([
        {
          selection_key: selectionKey,
          display_label: 'Refund UAT Mall',
          selection_kind: 'exact_machine',
          machine_id: '41000000-0000-4000-8000-000000000003',
          location_id: '41000000-0000-4000-8000-000000000002',
          location_timezone: 'America/Los_Angeles',
          cash_machine_options: [],
        },
      ]));
    });
    await context.route('**/functions/v1/refund-case-intake', async (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill(jsonResponse({
        refundCase: {
          id: `synthetic-${journey.name}`,
          publicReference: `RF-UAT-${journey.name.toUpperCase()}`,
          status: 'submitted',
          correlationStatus: 'not_started',
        },
      }));
    });

    const page = await context.newPage();
    await navigateRefundPortalPage(page, `${appUrl}${journey.path}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Machine location').selectOption(selectionKey);
    await page.getByLabel('Email').fill('   ');
    await page.getByRole('button', { name: 'Send refund request' }).click();
    recorder.assert(
      `${journey.name} refund journey rejects whitespace-only email without creating a case`,
      await page.getByText('Enter a valid email address.', { exact: true }).isVisible() &&
        submissions.length === 0
    );
    await page.getByLabel('Email').fill('synthetic-customer@example.test');
    await page.getByRole('radio', { name: /^Card/ }).click();
    await page.getByLabel('Amount paid').fill('7.00');
    await page.getByLabel('Last 4 digits shown for this payment').fill('4242');
    await page.getByLabel('What best describes the problem?').selectOption('charged_no_product');

    // Reproduce Chrome autofill/native-picker behavior: the controls visibly
    // contain valid values, but no input/change event reaches React state.
    await page.getByLabel('Purchase date').evaluate((control) => {
      control.value = '2026-08-11';
    });
    await page.getByLabel('Approximate purchase time').evaluate((control) => {
      control.value = '15:30';
    });

    recorder.assert(
      `${journey.name} refund journey visibly contains the native date and time`,
      await page.getByLabel('Purchase date').inputValue() === '2026-08-11' &&
        await page.getByLabel('Approximate purchase time').inputValue() === '15:30'
    );
    if (journey.expectedEmailContextToken) {
      recorder.assert(
        'Email-linked refund journey removes the private context token from the visible URL',
        !page.url().includes('emailContext=')
      );
    }

    await page.getByRole('button', { name: 'Send refund request' }).click();
    await page.waitForURL(/\/refunds\/thank-you$/, { timeout: 10000 });
    await page.getByText(`RF-UAT-${journey.name.toUpperCase()}`, { exact: true }).waitFor();

    const submission = submissions[0] ?? {};
    recorder.assert(
      `${journey.name} refund journey submits the visible native date and time`,
      submissions.length === 1 &&
        submission.incidentDate === '2026-08-11' &&
        submission.incidentTime === '15:30' &&
        submission.paymentMethod === 'card' &&
        submission.cardLast4 === '4242' &&
        submission.cardNetwork === undefined &&
        submission.paymentInteraction === 'unsure' &&
        submission.incidentTimeConfidence === 'rough' &&
        submission.selectionKey === selectionKey &&
        submission.machineId === undefined,
      JSON.stringify(submission)
    );
    recorder.assert(
      `${journey.name} refund journey preserves attachment-off safety`,
      submission.attachments === undefined &&
        (await page.locator('input[type="file"]').count()) === 0
    );
    recorder.assert(
      `${journey.name} refund journey preserves private email-context linkage`,
      submission.emailContextToken === journey.expectedEmailContextToken,
      JSON.stringify({ emailContextToken: submission.emailContextToken })
    );

    await closeRefundPortalContext(context);
  }
};
