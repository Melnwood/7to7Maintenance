// 7to7 Maintenance — Airtable proxy (Netlify Function)
// Token lives ONLY in Netlify (env var AIRTABLE_TOKEN). Browser never sees it.

const BASE_ID  = 'appGs7g0INHR4zicv';
const PROBLEMS = 'tblEPLcgnxd8JLNCQ';
const WORKLOG  = 'tblrETFLBC86UP7dd';
const PARTS    = 'tblGjZycgUCNxSdY0';
const OFFICES  = 'tblQtsQmJuoRvbT2q';
const API = 'https://api.airtable.com/v0/' + BASE_ID;

const P  = { problem:'Problem', office:'Office', chair:'Chair/Area', urgency:'Urgency',
             status:'Status', reporter:'Reported by', reported:'Reported', fixed:'Date fixed', history:'History' };
const W  = { entry:'Entry', problemId:'Problem ID', date:'Date', who:'Who', note:'Note',
             partNumber:'Part number', qty:'Qty used' };
const PT = { name:'Part name', number:'Part number', stock:'In warehouse', reorderAt:'Reorder at',
             bin:'Bin', vendor:'Vendor', lastOrdered:'Last ordered' };
const OF = { office:'Office', ops:'Ops', areas:'Area names', notes:'Notes' };

exports.handler = async function (event) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return resp(500, { error: 'Server not set up: AIRTABLE_TOKEN is missing in Netlify.' });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    if (event.httpMethod === 'GET') {
      const office = (event.queryStringParameters && event.queryStringParameters.office) || '';
      const issues = await fetchAll(PROBLEMS, headers, office ? "{" + P.office + "} = '" + esc(office) + "'" : '');
      const log    = await fetchAll(WORKLOG, headers, '');
      const parts  = await fetchAll(PARTS, headers, '');
      const offices= await fetchAll(OFFICES, headers, '');
      return resp(200, {
        issues: issues.map(mapIssue),
        worklog: log.map(mapLog),
        parts: parts.map(mapPart),
        offices: offices.map(mapOffice)
      });
    }
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (b.action === 'add')    return resp(200, await addIssue(b, headers));
      if (b.action === 'status') return resp(200, await setStatus(b, headers));
      if (b.action === 'note')   return resp(200, await addNote(b, headers));
      return resp(400, { error: 'unknown action' });
    }
    return resp(405, { error: 'method not allowed' });
  } catch (e) {
    return resp(500, { error: String((e && e.message) || e) });
  }
};

function resp(code, obj){ return { statusCode: code, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(obj) }; }
function esc(s){ return String(s).replace(/'/g, "\\'"); }
function cap(s){ s=String(s||''); return s ? s.charAt(0).toUpperCase()+s.slice(1).toLowerCase() : ''; }
function today(){ return new Date().toISOString().slice(0,10); }

async function fetchAll(table, headers, formula){
  let url = API + '/' + table + '?pageSize=100';
  if (formula) url += '&filterByFormula=' + encodeURIComponent(formula);
  var records = [], offset;
  do {
    var u = offset ? (url + '&offset=' + offset) : url;
    var r = await fetch(u, { headers: headers });
    if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
    var j = await r.json();
    records = records.concat(j.records);
    offset = j.offset;
  } while (offset);
  return records;
}

function mapIssue(r){ var f=r.fields; return {
  id:r.id, office:f[P.office]||'', chair:f[P.chair]||'', problem:f[P.problem]||'',
  impact:(f[P.urgency]||'').toLowerCase(), reporter:f[P.reporter]||'', status:f[P.status]||'New',
  date:f[P.reported]||'', fixed:f[P.fixed]||'', history:f[P.history]||'' }; }
function mapLog(r){ var f=r.fields; return {
  id:r.id, issueId:f[W.problemId]||'', date:f[W.date]||'', who:f[W.who]||'', note:f[W.note]||'',
  partNumber:f[W.partNumber]||'', qty:f[W.qty]||'' }; }
function mapPart(r){ var f=r.fields; var s=f[PT.stock], ra=f[PT.reorderAt]; return {
  id:r.id, name:f[PT.name]||'', number:f[PT.number]||'', inStock:(s==null?'':s), reorderAt:(ra==null?'':ra),
  bin:f[PT.bin]||'', vendor:f[PT.vendor]||'', lastOrdered:f[PT.lastOrdered]||'',
  orderNow:(typeof s==='number' && typeof ra==='number' && s<=ra) }; }
function mapOffice(r){ var f=r.fields; return {
  id:r.id, office:f[OF.office]||'', ops:(f[OF.ops]==null?'':f[OF.ops]), areas:f[OF.areas]||'', notes:f[OF.notes]||'' }; }

async function addIssue(b, headers){
  var fields = {};
  fields[P.problem]  = b.problem || '';
  fields[P.office]   = b.office || '';
  fields[P.chair]    = b.chair || '';
  if (b.impact) fields[P.urgency] = cap(b.impact);
  fields[P.reporter] = b.reporter || '';
  fields[P.status]   = 'New';
  fields[P.reported] = today();
  var r = await fetch(API + '/' + PROBLEMS, { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  return { ok:true, id:j.id };
}

async function setStatus(b, headers){
  var fields = {}; fields[P.status] = b.status;
  if (b.status === 'Fixed') fields[P.fixed] = today();
  var r = await fetch(API + '/' + PROBLEMS + '/' + b.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  // log the status change so the date is captured
  await logWork({ problemId:b.id, who:b.who||'', note:'Status changed to ' + b.status }, headers);
  return { ok:true };
}

async function addNote(b, headers){
  await logWork(b, headers);
  var msg = { ok:true };
  if (b.partNumber && Number(b.qty) > 0) msg.parts = await usePart(b.partNumber, Number(b.qty), headers);
  return msg;
}

async function logWork(b, headers){
  var fields = {};
  fields[W.entry]     = (b.who ? b.who + ' \u2014 ' : '') + String(b.note || '').slice(0, 40);
  fields[W.problemId] = b.problemId || b.issueId || '';
  fields[W.date]      = today();
  if (b.who) fields[W.who] = b.who;
  if (b.note) fields[W.note] = b.note;
  if (b.partNumber) fields[W.partNumber] = b.partNumber;
  if (Number(b.qty) > 0) fields[W.qty] = Number(b.qty);
  var r = await fetch(API + '/' + WORKLOG, { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
}

// find a Part by its part number and subtract qty from In warehouse
async function usePart(number, qty, headers){
  var formula = "{" + PT.number + "} = '" + esc(number) + "'";
  var found = await fetchAll(PARTS, headers, formula);
  if (!found.length) return { matched:false, message:'No part with number ' + number };
  var rec = found[0];
  var current = rec.fields[PT.stock];
  var next = (typeof current === 'number' ? current : 0) - qty;
  var fields = {}; fields[PT.stock] = next;
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { matched:true, remaining:next };
}
