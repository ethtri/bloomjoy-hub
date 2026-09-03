// Run with playwright-cli run-code --filename after opening localhost:8095.
// Synthetic responses only; every backend request is intercepted.
async (page) => {
  await page.unrouteAll({ behavior: 'wait' });
  const base = 'http://127.0.0.1:8095';
  const allowedFields = ['location_or_machine','incident_date','incident_time','payment_method','payment_interaction','wallet_provider','amount','card_last4','card_network'];
  const ready = { state:'ready', publicReference:'RF-RECOVERY-TEST',version:3,locale:'en',requestedFields:['card_last4'],allowedFields,
    locationChoices:[{key:'new-location',label:'Example second location'}],
    values:{location_or_machine:'Example original location',incident_date:'2026-09-03',incident_time:'14:30',payment_method:'card',payment_interaction:'tap_card',card_last4:'1234'} };
  let context=ready, inspectFailure=false, submitFailure=false, submitUnavailable=false, nextAction='review', inspectGate=null;
  const submissions=[]; const evidence=[];
  const check=(value,message)=>{if(!value)throw new Error(message);};
  await page.route('http://127.0.0.1:54321/**',async route=>{
    const request=route.request();
    if(!request.url().endsWith('/functions/v1/refund-case-intake')) throw new Error('Unexpected backend request');
    const body=request.postDataJSON();
    if(body.action==='inspectPurchaseCorrection') {
      if(inspectGate) await inspectGate;
      if(inspectFailure)return route.abort('failed');
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({correction:context})});
    }
    check(body.action==='submitPurchaseCorrection','Only correction actions allowed');
    if(submitFailure)return route.abort('failed');
    if(submitUnavailable)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({errorCode:'correction_unavailable'})});
    submissions.push(body);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({correction:{state:'received',publicReference:ready.publicReference,nextAction}})});
  });
  let sequence=0;
  const open=async()=>{
    sequence++; await page.goto(`${base}/refunds/correct#token=${String.fromCharCode(65+sequence).repeat(43)}`);
  };
  for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    context=JSON.parse(JSON.stringify(ready)); inspectFailure=false; submitUnavailable=false; submitFailure=false;
    let release; inspectGate=new Promise(resolve=>{release=resolve;});
    await open(); await page.getByRole('status').filter({hasText:'Opening your secure'}).waitFor();
    await page.screenshot({path:`output/playwright/correction-loading-${width}.png`,fullPage:true});
    inspectGate=null;release();
    await page.getByRole('button',{name:'Save my response',exact:true}).click();
    await page.getByRole('alert').waitFor();
    check(await page.getByRole('alert').evaluate(el=>el===document.activeElement),'Validation alert receives focus');
    await page.locator('#correction-card_last4-answer').selectOption('changed');
    await page.locator('#correction-card_last4').fill('5678');
    submitFailure=true;
    await page.context().setOffline(true);
    await page.getByRole('button',{name:'Save my response',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Your answers are still here'}).waitFor();
    check(await page.locator('#correction-card_last4').inputValue()==='5678','Failed save preserves answer');
    await page.screenshot({path:`output/playwright/correction-retry-${width}.png`,fullPage:true});
    await page.context().setOffline(false);
    submitFailure=false;nextAction='recheck';
    await page.getByRole('button',{name:'Save my response',exact:true}).click();
    await page.getByText('Bloomjoy is rechecking the purchase using your response.',{exact:false}).waitFor();
    check(await page.getByRole('heading',{name:'Your response is saved.'}).evaluate(el=>el===document.activeElement),'Saved heading receives focus');
    check(await page.locator('form').count()===0,'Saved response cannot resubmit');
    await page.screenshot({path:`output/playwright/correction-rechecking-${width}.png`,fullPage:true});

    inspectFailure=true;await open();
    await page.getByRole('heading',{name:'We couldn’t open your request.'}).waitFor();
    check(await page.getByText('This link is no longer available.',{exact:true}).count()===0,'Network failure is not expiry');
    inspectFailure=false;await page.getByRole('button',{name:'Try again / Intentar de nuevo'}).click();
    await page.locator('#correction-card_last4-answer').selectOption('confirmed');
    submitUnavailable=true;
    await page.getByRole('button',{name:'Save my response',exact:true}).click();
    await page.getByRole('heading',{name:'This link is no longer available.'}).waitFor();
    check(await page.locator('form').count()===0,'Stale save cannot retry against outdated facts');
    check(await page.getByText(ready.publicReference,{exact:true}).count()===1,'Same case reference preserved for support');
    submitUnavailable=false;

    for(const reason of ['expired','replaced','terminal']) {
      context={state:'unavailable'};await open();
      await page.getByRole('heading',{name:'This link is no longer available.'}).waitFor();
      check(await page.locator('form').count()===0,`${reason} context cannot edit`);
      evidence.push({width,state:reason,form:false});
    }
    context={state:'received',publicReference:ready.publicReference,nextAction:'review'};await open();
    await page.getByText('Someone at Bloomjoy will review your response',{exact:false}).waitFor();
    check(await page.locator('form').count()===0,'Already submitted inspection cannot mutate');
    await page.screenshot({path:`output/playwright/correction-already-received-${width}.png`,fullPage:true});

    context={...JSON.parse(JSON.stringify(ready)),locale:'es',requestedFields:['location_or_machine']};await open();
    await page.locator('#correction-location_or_machine-answer').selectOption('changed');
    await page.locator('#correction-location_or_machine').selectOption('new-location');
    await page.getByRole('status').filter({hasText:'Revise la fecha y la hora'}).waitFor();
    check(await page.locator('#correction-incident_date-answer').isVisible(),'Date dependency visible');
    check(await page.locator('#correction-incident_time-answer').isVisible(),'Time dependency visible');
    await page.locator('#correction-incident_date-answer').selectOption('confirmed');
    await page.locator('#correction-incident_time-answer').selectOption('cannot_provide');
    await page.screenshot({path:`output/playwright/correction-location-es-${width}.png`,fullPage:true});
    nextAction='review';await page.getByRole('button',{name:'Guardar mi respuesta',exact:true}).click();
    await page.getByText('Una persona de Bloomjoy revisará su respuesta',{exact:false}).waitFor();
    check(submissions.at(-1).answers.incident_time.disposition==='cannot_provide','Uncertainty remains explicit');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal overflow');
    evidence.push({width,loading:true,validationFocus:true,failedSavePreserved:true,retrySaved:true,recheckCopy:true,inspectRetry:true,staleNoForm:true,alreadyReceived:true,locationDependencies:true,spanishReview:true});
  }
  check(submissions.length===4,'Only four intended synthetic responses succeeded');
  await page.evaluate(value=>{window.__correctionRecoveryEvidence=value;},{evidence,syntheticSubmissions:submissions.length,liveWrites:0});
  return {evidence,syntheticSubmissions:submissions.length,liveWrites:0};
}

