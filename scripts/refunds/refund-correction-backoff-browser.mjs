// Real React Query polls with a controlled browser clock; synthetic reads only.
async (page) => {
  await page.unrouteAll({behavior:'wait'});
  await page.clock.install({time:new Date('2026-09-04T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-09-04T00:00:01Z'));
  const reads=[];
  await page.route('http://127.0.0.1:54321/**',async route=>{
    if(!route.request().url().endsWith('/functions/v1/refund-case-intake') || route.request().postDataJSON().action!=='inspectPurchaseCorrection') throw new Error('Unexpected non-inspection request');
    reads.push(await page.evaluate(()=>Date.now()));
    const number=reads.length;
    const failed=[2,3,4,6].includes(number);
    await route.fulfill({status:failed?503:200,contentType:'application/json',body:JSON.stringify(failed
      ? {errorCode:'correction_temporarily_unavailable'}
      : {correction:{state:'received',publicReference:'RF-BACKOFF-TEST',nextAction:number>=8?'review':'recheck'}})});
  });
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const settle=()=>page.waitForTimeout(150);
  const tick=async(ms)=>{await page.clock.runFor(ms);await settle();await page.clock.runFor(0);await settle();};
  const token=String(Date.now()).padEnd(43,'b');
  await page.goto(`http://127.0.0.1:8095/refunds/correct#token=${token}`);
  await settle();await tick(0);
  await page.getByRole('heading',{name:'Your response is saved.'}).waitFor();
  await settle();check(reads.length===1,'One initial inspect');
  for(const [delay,nextCount] of [[5000,2],[10000,3],[20000,4],[30000,5],[5000,6]]) {
    await tick(delay-1);check(reads.length===nextCount-1,`No early poll before ${delay}ms`);
    await tick(1);check(reads.length===nextCount,`Actual next poll occurs at ${delay}ms`);
    check(await page.getByRole('heading',{name:'Your response is saved.'}).isVisible(),'Consecutive errors preserve saved truth');
  }
  // A different explicit capability starts its own inspection/backoff session.
  await page.evaluate(value=>{window.location.hash=`token=${value}`;},token.slice(0,-1)+'c');
  await settle();await tick(0);check(reads.length===7,'New token has one immediate read');
  await tick(4999);check(reads.length===7,'New link normal interval has no early poll');
  await tick(1);check(reads.length===8,'New link uses normal five-second interval');
  await page.getByText('Someone at Bloomjoy will review your response',{exact:false}).waitFor();
  await tick(30000);check(reads.length===8,'Review stops polling');
  const result={pollIntervals:reads.slice(1,6).map((time,index)=>time-reads[index]),newTokenReset:true,reviewStopped:true,inspectionReads:reads.length,submissions:0};
  await page.clock.resume();
  return result;
}
