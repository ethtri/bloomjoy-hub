/* Fictional fixtures for concept review only. No live accounts or email sends. */
/* global digestBody */
const stats = (...items) => `<div class="stats">${items.map(([value,label,note])=>`<div class="stat"><strong>${value}</strong><span>${label}</span>${note?`<small>${note}</small>`:''}</div>`).join('')}</div>`;
const row = (label,value) => `<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`;
const quote = text => `<div class="quote"><div class="quote-label">Customer comment</div><blockquote>“${text}”</blockquote></div>`;
const callout = (title,text,tone='') => `<div class="callout ${tone}"><strong>${title}</strong><p>${text}</p></div>`;
const concepts = [
  {
    number:'01', id:'daily', name:'Daily operations brief', group:'Performance, by machine',
    phase:'Selected · Daily', audience:'Managers with reporting and case access. A technician version uses only permitted metrics and operational excerpts.',
    cadence:'Daily at the chosen time, after the prior local reporting day. Example: 8:00 AM Pacific.',
    trigger:'A daily snapshot of the authorized machine scope. Case status is current at send time; sales and new requests belong to yesterday.',
    why:'Scan fleet totals, then see every machine’s numbers and its customer reports together.',
    noise:'One combined email. Preserve all current manager open cases, including earlier requests, even when a sales source is missing. Combine with the existing digest only when scope and timing align.',
    readiness:'Existing reporting and refund records. Needs shared per-machine aggregation and recipient-safe rendering; no new live sends in this concept.',
    subject:'Daily summary · South Route · October 1',
    preheader:'$996 known sales before refunds. Four new requests, five open cases and three decisions.',
    label:'DAILY BRIEF · OCTOBER 1', title:'Yesterday, machine by machine.',
    intro:'Harbor Mall and Midtown have decisions ready. Here are your totals, followed by the numbers and customer reports for each machine.',
    scope:'4 followed machines · Pacific reporting dates · USD', body:digestBody('daily'),
    cta:'Open the October 1 report', destination:'Daily Hub report for the same authorized machine scope and reporting period.',
    foot:'You follow the daily operations brief for these machines. Existing manager notifications remain active.'
  },
  {
    number:'02', id:'weekly', name:'Weekly performance review', group:'',
    phase:'Selected · Weekly', audience:'Managers; technicians see only the reporting and operational information their existing access permits.',
    cadence:'Weekly on a chosen day and time, covering the last completed Monday–Sunday period.',
    trigger:'One completed week, compared with the preceding complete week using the same machine cohort and calculation snapshot.',
    why:'Compare each machine’s performance and see its refund requests, including those already resolved.',
    noise:'One email across the selected machines. Include zero-request machines. Unknown, zero-baseline or incomplete comparisons show no percentage change.',
    readiness:'Existing report calculation and request data. New per-machine period grouping and safe comment excerpts. Dates and status clocks are explicit.',
    subject:'Weekly summary · South Route · September 21–27',
    preheader:'$8,420 sales before refunds, up 7.9%. Six new requests, grouped by machine.',
    label:'WEEKLY REVIEW · SEPTEMBER 21–27', title:'The week, machine by machine.',
    intro:'Sales before refunds rose 7.9% across the same four machines. Midtown has one decision ready; each machine’s requests are listed below its results.',
    scope:'4 followed machines · Pacific reporting dates · USD', body:digestBody('weekly'),
    cta:'Open the September 21–27 report', destination:'Weekly Hub report using the same period, machine cohort and source calculation.',
    foot:'You receive the weekly review for these 4 followed machines.'
  },
  {
    number:'03', id:'new-refund', name:'New refund request', group:'A report, then a decision',
    phase:'Selected · At submission', audience:'Subscribed technicians and managers, using different authorized case views.',
    cadence:'At first submission, or in the next daily brief if chosen. Quiet hours apply to optional immediate alerts.',
    trigger:'One distinct canonical request is first submitted for a followed machine. Corrections, replies and duplicate intake do not create another new-request email.',
    why:'Give the person responsible for a machine the customer’s symptom while refund preparation continues.',
    noise:'One notice per request and recipient. For a manager receiving a ready-decision notice for the same event, that action notice takes precedence. A technician receives only the operational view.',
    readiness:'Existing request and machine fields. Needs opt-in subscriptions and a safe operational case projection. No customer identity or payment credentials in email.',
    subject:'New refund request · Harbor Mall · BJ-014',
    preheader:'Customer selected “Charged/paid but no product.” Received October 1 at 2:14 PM.',
    label:'NEW REFUND REQUEST · R-1042', title:'A customer reported a problem.',
    intro:'A customer submitted a request for BJ-014. Their report may help you decide whether the machine needs a check.',
    scope:'Harbor Mall · BJ-014 · Pacific time',
    body:row('Request','R-1042 · Received')+row('Submitted','October 1, 2:14 PM')+row('Incident reported','October 1, about 2:00 PM')+row('Customer selected','Charged/paid but no product')+quote('I paid and the machine started, but no candy came out.')+callout('For your next machine check','Review the reported symptom. Bloomjoy is preparing the customer’s request; no refund decision is needed from you yet.'),
    cta:'View report R-1042', destination:'Authenticated technician-safe operational view of R-1042, or the manager’s current authorized case view.',
    foot:'You follow new refund requests for Harbor Mall · BJ-014.'
  },
  {
    number:'04', id:'decision-ready', name:'Refund decision ready', group:'',
    phase:'Selected · Existing manager alert', audience:'The current assigned machine manager, following existing recipient routing and authority.',
    cadence:'When a decision becomes ready or a material change requires a different decision.',
    trigger:'Existing canonical case state is ready for this manager’s final decision. Ordinary automatic gift-card requests are not turned into manager decisions.',
    why:'Make the actual decision obvious, with the exact case, reviewed amount and customer evidence.',
    noise:'Reuse the current ready-notice and delivery ledger. Revalidate recipient and decision state before sending. Optional preferences do not disable this workflow.',
    readiness:'Existing workflow and templates. This is a presentation refinement, not a second approval process or payment action.',
    subject:'Refund ready for your decision · Harbor Mall · R-1042',
    preheader:'Review the prepared $10.90 card refund in Bloomjoy Hub.',
    label:'MANAGER DECISION · R-1042', title:'This request is ready for you.',
    intro:'The selected purchase and proposed card refund are ready for your review. Read the evidence, then approve or deny in Hub.',
    scope:'Harbor Mall · BJ-014 · Pacific time',
    body:stats(['$10.90','Prepared card refund','Selected purchase includes tax'],['Not sent','Payment state','Waiting for your decision'])+row('Customer selected','Charged/paid but no product')+row('Purchase selected','October 1, 2:03 PM')+row('Decision ready','October 1, 2:20 PM')+quote('I paid and the machine started, but no candy came out.'),
    cta:'Review R-1042', destination:'Existing exact-case manager review for R-1042. Opening the preview does not execute a refund.',
    foot:'You received this because you are an assigned manager for BJ-014.', required:true
  },
  {
    number:'07', id:'sales-quiet', name:'Sales unexpectedly quiet', group:'Investigate a change',
    phase:'Selected · Validate sales coverage', audience:'Subscribed managers and route technicians with reporting access.',
    cadence:'After a complete source period becomes available. Start with daily comparisons; intraday alerts require proven timely data.',
    trigger:'Illustrative rule: 12 transactions versus a median of 40 across 8 comparable open Thursdays, a 70% decline. Compare pre-refund sales so refund deductions do not manufacture a sales drop.',
    why:'Prompt a location or machine check when activity changes substantially.',
    noise:'Use complete comparable periods and open hours. Exclude closures and planned maintenance. Group one active condition per machine; cooldown and re-arm on a meaningful change.',
    readiness:'History exists but vendor cash is batch-imported and report completeness is not universally proven. The example assumes a verified completed period; a two-hour live detector is not claimed ready.',
    subject:'Sales below usual · Harbor Mall · September 24',
    preheader:'12 transactions recorded; the usual Thursday median is 40.',
    label:'ACTIVITY CHECK · COMPLETED DAY', title:'A quieter day than usual.',
    intro:'BJ-014 recorded substantially less activity on Thursday, September 24. Check the location context and machine activity to decide whether a visit is needed.',
    scope:'Harbor Mall · BJ-014 · Pacific reporting day',
    body:stats(['12','Transactions recorded','September 24'],['40','Usual Thursday median','8 comparable completed days'])+row('Sales before refunds','$120 · Excludes sales tax')+row('Transaction difference','70% below usual')+row('Scheduled open hours','10:00 AM–8:00 PM')+row('Period verified in this example','September 24, full day')+row('Report generated','September 25, 8:00 AM')+callout('Check the context','Lower traffic, a location change or a machine issue may explain the difference. Low sales alone do not establish a fault.'),
    cta:'Check BJ-014 activity', destination:'Reporting view of September 24 and its comparable periods, with current machine context.',
    foot:'You follow unusual sales activity for Harbor Mall · BJ-014.'
  },
  {
    number:'08', id:'device-offline', name:'Device reports offline', group:'',
    phase:'Selected · Verify the status feed', audience:'The responsible subscribed technician; optional manager visibility.',
    cadence:'After a continuously observed offline state. Example: 15 minutes, not an established production threshold.',
    trigger:'An authoritative feed explicitly identifies the exact component as offline, with recent source observations. Failed polling or stale data means unknown, not offline.',
    why:'Send someone a precise connection check, naming the device rather than assuming the entire machine is down.',
    noise:'Debounce brief changes, coalesce provider-wide problems and suppress expected maintenance. Do not send a quiet-sales alert for the same known offline incident.',
    readiness:'Point-in-time Nayax status and raw vendor device fields exist, but their meanings, cadence and continuous history need verification. Existing “attention” status is not proof of a sustained offline event.',
    subject:'Payment device reports offline · Harbor Mall · BJ-014',
    preheader:'The reported offline state has persisted for 15 minutes.',
    label:'DEVICE CONNECTION · STATUS CONFIRMED', title:'The payment device needs a check.',
    intro:'The payment device connected to BJ-014 has reported an offline status since 2:10 PM. Check its connection and whether customers can make purchases.',
    scope:'Harbor Mall · BJ-014 · October 1 · Pacific time',
    body:'<span class="status-badge">Payment device · Offline</span>'+row('First offline observation','2:10 PM')+row('Latest source observation','2:25 PM')+row('Observed duration','15 minutes')+row('Whole-machine operation','Unverified')+callout('Suggested check','Confirm power and connectivity for the payment device using its service guide. Record what you find in Hub.'),
    cta:'View BJ-014 device status', destination:'Proposed device evidence screen with exact component, source observations and approved troubleshooting guide.',
    foot:'You follow device connection alerts for Harbor Mall · BJ-014.'
  }
];
const escapeHtml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected = concepts[0];
const mail = c => `<div class="envelope"><div class="subject">${c.subject}</div><div class="sender"><span class="avatar" aria-hidden="true">b</span><span><strong>Bloomjoy Hub</strong> &nbsp; to you · Example email</span></div><p class="preheader">${c.preheader}</p></div><article class="email" aria-label="${c.name} email mockup"><div class="email-brand">bloomjoy<span>HUB</span></div><div class="label">${c.label}</div><h2>${c.title}</h2><p class="intro-copy">${c.intro}</p><p class="meta">${c.scope}</p>${c.body}<button class="cta" data-destination="${escapeHtml(c.destination)}">${c.cta} ↗</button><p class="after-cta">Preview only · opens no live account</p><footer class="email-footer"><p>${c.foot}</p><div class="foot-links"><button data-preferences>Manage alerts</button>${c.required?'<span>Existing manager notification</span>':'<button data-unsubscribe>Turn off this alert</button>'}</div><p>Synthetic example · Bloomjoy Hub concept review</p></footer></article>`;
function renderConcept(id,updateHash=true){selected=concepts.find(c=>c.id===id)||concepts[0];document.querySelectorAll('.candidate').forEach(b=>{const on=b.dataset.id===selected.id;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});document.querySelector('#candidate-select').value=selected.id;document.querySelector('#preview-label').textContent=`${selected.number} · Selected alert · Round 2`;document.querySelector('#mail-frame').innerHTML=mail(selected);document.querySelector('#concept-details').innerHTML=`<span class="phase">${selected.phase}</span><h2>${selected.name}</h2><p class="why">${selected.why}</p><dl>${[['Who it helps',selected.audience],['When it arrives',selected.cadence],['What triggers it',selected.trigger],['Keep it useful',selected.noise],['What it needs',selected.readiness]].map(([t,d])=>`<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>`;document.querySelector('#status').textContent='';if(updateHash)history.replaceState(null,'',`#${selected.id}`);}
document.querySelector('#candidate-list').innerHTML=concepts.map(c=>`${c.group?`<p class="group-label">${c.group}</p>`:''}<button class="candidate" data-id="${c.id}" aria-pressed="false"><span class="number">${c.number}</span><span>${c.name}</span></button>`).join('');
document.querySelector('#candidate-select').innerHTML=concepts.map(c=>`<option value="${c.id}">${c.number} · ${c.name}</option>`).join('');
document.querySelector('#candidate-list').addEventListener('click',event=>{const b=event.target.closest('[data-id]');if(b)renderConcept(b.dataset.id);});
document.querySelector('#candidate-select').addEventListener('change',e=>renderConcept(e.target.value));
function showPreferences(show){document.querySelector('#gallery').hidden=show;document.querySelector('#preferences').hidden=!show;document.querySelector('#emails-tab').classList.toggle('active',!show);document.querySelector('#preferences-tab').classList.toggle('active',show);document.querySelector('#emails-tab').setAttribute('aria-pressed',String(!show));document.querySelector('#preferences-tab').setAttribute('aria-pressed',String(show));document.querySelector('#status').textContent='';history.replaceState(null,'',show?'#preferences':`#${selected.id}`);}
document.querySelector('#emails-tab').onclick=()=>showPreferences(false);
document.querySelector('#preferences-tab').onclick=()=>showPreferences(true);
for(const mode of ['desktop','mobile'])document.querySelector(`#${mode}-button`).onclick=()=>{document.querySelector('#mail-frame').classList.toggle('mobile',mode==='mobile');for(const m of ['desktop','mobile']){document.querySelector(`#${m}-button`).classList.toggle('active',m===mode);document.querySelector(`#${m}-button`).setAttribute('aria-pressed',String(m===mode));}};
document.addEventListener('click',e=>{const destination=e.target.closest('[data-destination]');if(destination){document.querySelector('#status').textContent=`Concept destination: ${destination.dataset.destination}`;document.querySelector('#status').scrollIntoView({behavior:'instant',block:'nearest'});}if(e.target.closest('[data-preferences]')){showPreferences(true);document.querySelector('#preferences').scrollIntoView({behavior:'instant',block:'start'});}if(e.target.closest('[data-unsubscribe]')){showPreferences(true);const checkbox=document.querySelector(`#pref-${selected.id}`);if(checkbox){checkbox.checked=false;document.querySelector('#pref-feedback').textContent=`${selected.name} is turned off in this preview. No live subscription changed.`;checkbox.scrollIntoView({behavior:'instant',block:'center'});}else document.querySelector('#pref-feedback').textContent=`${selected.name} would be turned off here once this future category is available. No live subscription changed.`;}});
const optional = concepts.filter(c=>!c.required);
document.querySelector('#preferences').innerHTML=`<div class="pref-head"><p class="eyebrow">SUBSCRIPTION SETTINGS · ROUND 2</p><h2>Choose what reaches your inbox.</h2><p>Follow the machines you work with. Pick the updates that help you, and when you’d like to receive them.</p></div><form id="preference-form"><section class="pref-section"><h3>Start with your role</h3><div class="preset-buttons"><button type="button" class="quiet-button" data-preset="manager">Manager preset</button><button type="button" class="quiet-button" data-preset="technician">Technician preset</button></div><p class="fine" style="font-size:12px;color:var(--muted);margin:12px 0 0">Presets are editable suggestions. They do not grant access or save a subscription.</p></section><section class="pref-section"><h3>1. Follow your machines</h3><div class="pref-grid"><div><label class="check-row"><input type="checkbox" name="machine" value="BJ-014" checked><span>Harbor Mall · BJ-014<small>Current authorized machine</small></span></label><label class="check-row"><input type="checkbox" name="machine" value="BJ-021" checked><span>Midtown · BJ-021<small>Current authorized machine</small></span></label><label class="check-row"><input type="checkbox" name="machine" value="BJ-032" checked><span>Pine Square · BJ-032<small>Current authorized machine</small></span></label><label class="check-row"><input type="checkbox" name="machine" value="BJ-061" checked><span>West Arcade · BJ-061<small>Current authorized machine</small></span></label></div><div class="pref-note">Only machines you can already access appear here. New machines are not followed automatically. Losing access removes them from future emails.</div></div></section><section class="pref-section"><h3>2. Pick your optional updates</h3><div class="check-list">${optional.map(c=>`<label class="check-row"><input type="checkbox" id="pref-${c.id}" name="alert" value="${c.id}" ${c.id==='weekly'?'checked':''}><span>${c.name}<small>${c.phase}${['device-offline','sales-quiet'].includes(c.id)?' · signal validation needed':''}</small></span></label>`).join('')}</div><p class="pref-note" style="margin-top:18px">Existing manager decision emails and the daily open-refund digest remain separate. Changing these optional choices does not turn those workflows off. Technician subscriptions do not include manager authority.</p></section><section class="pref-section"><h3>3. Set your schedule</h3><div class="pref-grid"><label class="field">Time zone<select name="timezone"><option>America/Los_Angeles</option><option>America/Chicago</option><option>America/New_York</option></select></label><label class="field">Weekly review<select name="weekly-day"><option>Monday</option><option>Friday</option><option>Sunday</option></select></label><label class="field">Digest delivery time<input name="delivery" type="time" value="08:00" required></label><label class="field">New customer reports<select name="intake-frequency"><option>Send immediately</option><option>Include in daily brief</option></select></label></div></section><section class="pref-section"><h3>4. Protect your quiet hours</h3><div class="pref-grid"><label class="field">Quiet hours start<input name="quiet-start" type="time" value="20:00" required></label><label class="field">Quiet hours end<input name="quiet-end" type="time" value="07:00" required></label></div><label class="check-row"><input name="urgent-bypass" type="checkbox"><span>Allow device-offline alerts during quiet hours<small>Optional and off by default. Requires a validated device-status feed.</small></span></label><p style="font-size:12px;color:var(--muted)">Optional immediate alerts wait until quiet hours end. Digest times inside quiet hours move to the next allowed time. A customer report alone never bypasses quiet hours.</p></section><div class="pref-actions"><button class="primary-button" type="submit">Save preview choices</button><span>This is a local demonstration. No email will be sent.</span></div><p id="pref-feedback" role="status" aria-live="polite"></p></form>`;
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{document.querySelectorAll('input[name="alert"]').forEach(c=>c.checked=button.dataset.preset==='manager'?['daily','weekly','sales-quiet'].includes(c.value):['new-refund','device-offline'].includes(c.value));document.querySelector('#pref-feedback').textContent=`${button.dataset.preset==='manager'?'Manager':'Technician'} suggestions selected. Review and edit them before saving the preview.`;});
document.querySelector('#preference-form').onsubmit=e=>{e.preventDefault();const machines=[...document.querySelectorAll('input[name="machine"]:checked')];const alerts=[...document.querySelectorAll('input[name="alert"]:checked')];const output=document.querySelector('#pref-feedback');if(!machines.length&&alerts.length){output.textContent='Choose at least one machine for the selected optional alerts.';output.setAttribute('role','alert');return;}output.setAttribute('role','status');output.textContent=`Preview saved for this page session: ${machines.length} machines, ${alerts.length} optional updates. No live subscriptions changed and no email sent.`;};
document.querySelector('#print-gallery').innerHTML=concepts.map(c=>`<section class="print-concept"><h1>${c.number} · ${c.name}</h1><p>${c.phase} · Round 2 · All content is fictional.</p><div class="mail-frame">${mail(c)}</div></section>`).join('');
document.querySelector('#print-button').onclick=()=>window.print();
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id==='preferences')showPreferences(true);else{renderConcept(id,false);showPreferences(false);}});
renderConcept(location.hash.slice(1),false);if(location.hash==='#preferences')showPreferences(true);
