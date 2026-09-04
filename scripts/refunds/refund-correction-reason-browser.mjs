// Synthetic inspect-only proof. Run in playwright-cli on localhost:8099.
async (page) => {
  await page.unrouteAll({behavior:'wait'});
  const base='http://127.0.0.1:8099';
  let context; let reads=0; const results=[];
  await page.route('http://127.0.0.1:54321/**', async route => {
    if(route.request().postDataJSON().action!=='inspectPurchaseCorrection') throw new Error('Unexpected write');
    reads++;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({correction:context})});
  });
  let sequence=0;
  for(const width of [390,1440]) for(const locale of ['en','es']) for(const fields of [['amount'],['card_last4'],['amount','card_last4'],['zelle_payment_contact']]) {
    context={state:'ready',version:1,publicReference:'RF-REASON-SYNTHETIC',locale,requestedFields:fields,allowedFields:fields,values:{}};
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/refunds/correct#token=${String(++sequence).padEnd(43,'a')}`);
    const reason=page.getByTestId('correction-reason'); await reason.waitFor();
    const expected=await page.evaluate(async ({fields,locale}) => {
      const copy=await import('/supabase/functions/_shared/refund-correction-copy.ts');
      const reason=copy.refundCorrectionReason(fields,locale==='es');
      if(!copy.refundCorrectionCopy(fields,'RF-REASON-SYNTHETIC',locale==='es').paragraphs.includes(reason)) throw new Error('Preview differs from form reason');
      return reason;
    },{fields,locale});
    if(await reason.innerText()!==expected)throw new Error('Rendered reason differs from canonical preview');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow');
    if(fields.length===2) await page.screenshot({path:`output/playwright/correction-reason-${locale}-${width}.png`,fullPage:true});
    results.push({width,locale,fields,matched:true});
  }
  console.log(JSON.stringify({results,reads,submissions:0}));
}
