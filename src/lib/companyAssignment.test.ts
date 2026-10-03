/// <reference lib="deno.ns" />
import { changeCompanyAssignment, singleEligibleCompanyId, validateCompanyAssignment, type CompanyAssignmentDraft, type CompanyChoice } from './companyAssignment.ts';

const companies: CompanyChoice[] = [
  { accountId: 'a', accountName: 'Company A', status: 'active', locations: [{ locationId: 'a1', locationName: 'Same venue', timezone: 'America/New_York', status: 'active' }] },
  { accountId: 'b', accountName: 'Zero machine company', status: 'active', locations: [{ locationId: 'b1', locationName: 'Same venue', timezone: 'America/Chicago', status: 'active' }] },
];
const saved = { accountId: 'a', accountName: 'Company A', locationId: 'a1', locationName: 'Same venue', locationTimezone: 'America/New_York' };
const draft: CompanyAssignmentDraft = { ...saved, addLocation: false };
const assert = (truth: unknown, message: string) => { if (!truth) throw new Error(message); };

Deno.test('new assignment only preselects exactly one permitted company, including a zero-machine company', () => {
  assert(singleEligibleCompanyId(companies) === '', 'Multiple choices must remain blank');
  assert(singleEligibleCompanyId([]) === '', 'Empty choices must remain blank');
  assert(singleEligibleCompanyId([companies[1]]) === 'b', 'Zero machine company is eligible');
  assert(singleEligibleCompanyId([{ ...companies[0], status: 'inactive' }]) === 'a', 'General assignments preserve existing inactive company authority');
  assert(singleEligibleCompanyId([{ ...companies[0], status: 'inactive' }], true) === '', 'SnapCase retains its inherited active target validation');
});
Deno.test('general company assignment permits inactive targets without changing company or location status', () => {
  const inactive = { ...companies[1], status: 'inactive', locations: [{ ...companies[1].locations[0], status: 'inactive' }] };
  const selected = { ...draft, accountId: 'b', locationId: 'b1' };
  assert(validateCompanyAssignment(selected, [inactive], saved) === null, 'Inactive general target remains selectable');
  assert(Boolean(validateCompanyAssignment(selected, [inactive], saved, true)), 'SnapCase keeps inherited validation');
  assert(inactive.status === 'inactive' && inactive.locations[0].status === 'inactive', 'Selection never reactivates company/location');
});
Deno.test('company change clears incompatible location IDs without matching equal names and restores only the saved ID', () => {
  const changed = changeCompanyAssignment(draft, 'b', saved);
  assert(changed.locationId === '', 'Do not select a same-named location');
  assert(changed.locationTimezone === 'America/New_York', 'Offer saved venue timezone, not Pacific');
  assert(changeCompanyAssignment(changed, 'a', saved).locationId === 'a1', 'Returning to saved company restores saved location');
  assert(Boolean(validateCompanyAssignment(changed, companies, saved)), 'Location choice is required');
});
Deno.test('unchanged inactive/unavailable saved assignments remain valid; changing targets requires authorized compatible IDs', () => {
  assert(validateCompanyAssignment(draft, [], saved) === null, 'Unavailable unchanged assignment is preserved');
  assert(Boolean(validateCompanyAssignment({ ...draft, accountId: 'b' }, companies, saved)), 'Mismatched location must fail');
  assert(Boolean(validateCompanyAssignment({ ...draft, accountId: 'unknown', locationId: 'b1' }, companies, saved)), 'Unknown target must fail');
  assert(validateCompanyAssignment({ ...draft, accountId: 'b', locationId: 'b1' }, companies, saved) === null, 'Chosen compatible location works');
});
Deno.test('explicit new locations require a name and valid IANA timezone on edits too', () => {
  const changed = { ...changeCompanyAssignment(draft, 'b', saved), addLocation: true };
  assert(validateCompanyAssignment(changed, companies, saved) === null, 'Saved Eastern timezone is valid editable context');
  assert(Boolean(validateCompanyAssignment({ ...changed, locationTimezone: '' }, companies, saved)), 'Timezone cannot be omitted');
  assert(Boolean(validateCompanyAssignment({ ...changed, locationTimezone: 'Pacific' }, companies, saved)), 'Timezone labels are not IANA identifiers');
  assert(Boolean(validateCompanyAssignment({ ...changed, locationName: ' ' }, companies, saved)), 'New location name cannot be blank');
});
