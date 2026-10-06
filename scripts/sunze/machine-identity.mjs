import { usableSunzeMachineName } from '../../supabase/functions/_shared/sunze-machine-name.mjs';

// Actual authenticated Machine Center DOM: device-name and head-status are
// different fields; proximity to an ID must never make a status into a name.
export const readSunzeMachineFields = () => Array.from(document.querySelectorAll('.device-id')).map(identity => ({
  machineCode: identity.querySelector('.id-code')?.textContent?.trim() || '',
  machineName: identity.parentElement?.querySelector('.device-name')?.textContent?.trim() || null,
  machineNameEvidence: 'explicit_field',
}));

export const normalizeSunzeMachineFields = records => records.filter(record => /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(record.machineCode)).map(record => ({
  machineCode:record.machineCode,
  machineName:usableSunzeMachineName(record.machineName,record.machineNameEvidence==='explicit_field'),
  machineNameEvidence:record.machineNameEvidence==='explicit_field' ? 'explicit_field' : null,
}));

export const extractSunzeMachineIdentitiesFromText = text => {
  const lines=String(text??'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),records=[];
  for(let index=0;index<lines.length;index++) {
    const match=lines[index].match(/^Machine\s*ID\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,79})$/i);
    const code=match?.[1] || (/^Machine\s*ID\s*[:：]?$/i.test(lines[index]) ? lines[index+1] : null);
    if(!code || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(code))continue;
    let name=null;
    for(let prior=index-1;prior>=Math.max(0,index-5);prior--) {
      if(/^Machine\s*ID/i.test(lines[prior]))break;
      const named=lines[prior].match(/^Machine\s*Name\s*[:：]\s*(.+)$/i);
      if(named){name=named[1];break;}
    }
    records.push({machineCode:code,machineName:name,machineNameEvidence:name?'explicit_field':null});
  }
  return normalizeSunzeMachineFields(records);
};
