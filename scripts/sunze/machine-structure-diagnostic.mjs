// Serialized into a read-only provider page. Never read input values, storage,
// network bodies, HTML, account menus, or order/customer content.
export const inspectSunzeMachineStructure = () => {
  const visible = element => element.getClientRects().length > 0;
  const classes = element => Array.from(element.classList).filter(value => /^[a-zA-Z0-9_-]{1,70}$/.test(value)).slice(0,8);
  const safeText = value => {
    const text = String(value || '').replace(/\s+/g,' ').trim();
    return !/\d{7}/.test(text) && /^(?:next|previous|prev|first|last|page|pages|total|items|records|machines|devices|of|go to|showing|show|per page|\/|:|\d|\s|[<>»«→←])+$/i.test(text) ? text.slice(0,100) : text ? `[text length ${text.length}]` : '';
  };
  const describe = element => ({tag:element.tagName.toLowerCase(),classes:classes(element),role:element.getAttribute('role'),label:safeText(element.getAttribute('aria-label') || element.getAttribute('title')),text:safeText(element.textContent),disabled:element.hasAttribute('disabled') || element.getAttribute('aria-disabled')==='true'});
  const controls = Array.from(document.querySelectorAll('button,[role="button"],nav,[role="navigation"],select,[class*="pagination"],[class*="pager"]')).filter(visible).slice(0,80).map(describe);
  const scrollContainers = Array.from(document.querySelectorAll('body,main,section,div,ul')).filter(element=>visible(element)&&element.scrollHeight>element.clientHeight+5&&element.clientHeight>0).slice(0,20).map(element=>({...describe(element),text:undefined,scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,overflowY:getComputedStyle(element).overflowY}));
  const identityElements = Array.from(document.querySelectorAll('body *')).filter(element=>visible(element)&&element.children.length===0&&/Machine\s*ID/i.test(element.textContent || '')).slice(0,10);
  const identities = identityElements.map(element=>{
    const ancestor=element.parentElement?.parentElement || element;
    return {identityElement:describe(element),parent:describe(element.parentElement || element),structure:Array.from(ancestor.querySelectorAll('*')).slice(0,35).map(child=>({...describe(child),text:/^(?:Running|Off|Online|Offline|Normal|Abnormal|Machine ID|Machine Name|Device ID|Device Name|No set name)$/i.test((child.textContent||'').trim()) ? child.textContent.trim() : safeText(child.textContent)}))};
  });
  return {controls,scrollContainers,identities,visibleIdentityElementCount:identityElements.length};
};
