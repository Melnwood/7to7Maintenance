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
             partNumber:'Part number', qty:'Qty used', photo:'Photo' };
const PHOTO_FIELD = 'fldEcNp6pnrOaYErL'; // Work Log → Photo (attachments)

// "Max" target per part number (how many they want on the shelf) — from the warehouse sheet
const MAXBYNUM = {"7052":15,"5873":12,"5877":5,"6161":10,"DA1175-FI":8,"4580":12,"4585":8,"DA1173-CB":4,"3635":25,"~0044":4,"8164":10,"JazzHolder":10,"DA1254-HUB":4,"DA1236UHB":10,"DA-m-0018-CST":10,"DA1153-S":6,"MGT-2450":4,"DA-M-0018-DD":2,"DA-M-0018-CSM 30K":3,"DA-M-0018-CFM 25K":1,"432T":10,"4421":4,"4425":4,"8631":2,"8959":8,"3600":6,"3640":4,"5150":8,"DA1284-5":0,"5660":15,"7795543":4,"5670":10,"8688":6,"8890":6,"7350":15,"4430":4,"4433":4,"5948":4,"120T":0,"9556059":10,"3637":18,"DA-M-0018-CSAEC":8,"DA1138-WH":4,"~0053":4,"6301":8,"DA1162-PC":2,"DA1172-A":1,"DA1287LID":2,"DA1278-Base":2,"5811":2,"5171":10,"DA0018-SOL":3,"2110":1,"P31-07E":2,"~0052":0,"AE-23":0,"P31-16":1,"S611R":40,"432R":0,"DA1340FE":0,"DA1345-SH":0,"8941":6,"JazzExt Cable":0,"G1429075":2,"G210375001":0,"G0321422":0,"9963659":0,"DA1178-CMSV":0,"DA1178-MSV":0,"9559097":14,"733":40,"Jazzext C-C":8,"8136":10,"8943":10,"DA1231-CBB":6,"7784806":10,"C Hub":5,"703":10,"0123":8,"7012":0};
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
function mapLog(r){ var f=r.fields; var ph=f[W.photo]; return {
  id:r.id, issueId:f[W.problemId]||'', date:f[W.date]||'', who:f[W.who]||'', note:f[W.note]||'',
  partNumber:f[W.partNumber]||'', qty:f[W.qty]||'',
  photo:(ph&&ph[0])?((ph[0].thumbnails&&ph[0].thumbnails.large&&ph[0].thumbnails.large.url)||ph[0].url):'' }; }
function mapPart(r){ var f=r.fields; var s=f[PT.stock], ra=f[PT.reorderAt]; var mx=MAXBYNUM[f[PT.number]]; return {
  id:r.id, name:f[PT.name]||'', number:f[PT.number]||'', inStock:(s==null?'':s), reorderAt:(ra==null?'':ra),
  max:(mx==null?'':mx), bin:f[PT.bin]||'', vendor:f[PT.vendor]||'', lastOrdered:f[PT.lastOrdered]||'',
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
  var parts = normalizeParts(b);
  var first = parts[0];
  // primary work-log row carries the note text; first part rides along
  var primaryId = await logWork({ problemId:b.problemId||b.issueId, who:b.who, note:b.note,
                  partNumber: first ? first.number : '', qty: first ? first.qty : '' }, headers);
  // any additional parts get their own short rows so each qty is captured
  for (var i = 1; i < parts.length; i++){
    await logWork({ problemId:b.problemId||b.issueId, who:b.who, note:'(same job)',
                    partNumber: parts[i].number, qty: parts[i].qty }, headers);
  }
  // decrement every matched part
  var results = [];
  for (var k = 0; k < parts.length; k++){
    if (parts[k].number && parts[k].qty > 0){
      var res = await usePart(parts[k].number, parts[k].qty, headers);
      results.push(Object.assign({ number:parts[k].number, qty:parts[k].qty }, res));
    }
  }
  var out = { ok:true, parts: results };
  // attach a photo to the primary row, if one was sent (non-fatal)
  if (b.photo && primaryId){
    try { await uploadPhoto(primaryId, b.photo, b.photoType, b.photoName, headers); out.photo = true; }
    catch (e){ out.photo = false; out.photoError = String((e && e.message) || e); }
  }
  return out;
}

function normalizeParts(b){
  var out = [];
  if (Array.isArray(b.parts)){
    b.parts.forEach(function(p){
      var num = String((p && (p.partNumber || p.number)) || '').trim();
      var q = Number((p && p.qty) || 0);
      if (num) out.push({ number:num, qty: q > 0 ? q : 0 });
    });
  } else if (b.partNumber){
    out.push({ number:String(b.partNumber).trim(), qty: Number(b.qty || 0) > 0 ? Number(b.qty) : 0 });
  }
  return out;
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
  var j = await r.json();
  return j.id;
}

// upload a base64 image straight into the Work Log row's Photo attachment field
async function uploadPhoto(recordId, base64, contentType, filename, headers){
  var url = 'https://content.airtable.com/v0/' + BASE_ID + '/' + recordId + '/' + PHOTO_FIELD + '/uploadAttachment';
  var body = JSON.stringify({ contentType: contentType || 'image/jpeg', filename: filename || 'photo.jpg', file: base64 });
  var r = await fetch(url, { method:'POST', headers:headers, body:body });
  if (!r.ok) throw new Error('Attach ' + r.status + ': ' + (await r.text()));
  return true;
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
