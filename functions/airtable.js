// 7to7 Maintenance — Airtable proxy (Netlify Function)
// BUILD: v2026.06.29-crew
// Token lives ONLY in Netlify (env var AIRTABLE_TOKEN). Browser never sees it.

const BASE_ID  = 'appGs7g0INHR4zicv';
const PROBLEMS = 'tblEPLcgnxd8JLNCQ';
const WORKLOG  = 'tblrETFLBC86UP7dd';
const PARTS    = 'tblGjZycgUCNxSdY0';
const OFFICES  = 'tblQtsQmJuoRvbT2q';
const ASSETS   = 'tbl313FCS3qRDNAmc';
const API = 'https://api.airtable.com/v0/' + BASE_ID;

const P  = { problem:'Problem', office:'Office', chair:'Chair/Area', urgency:'Urgency',
             status:'Status', reporter:'Reported by', reported:'Reported', fixed:'Date fixed', history:'History' };
const W  = { entry:'Entry', problemId:'Problem ID', date:'Date', who:'Who', note:'Note',
             partNumber:'Part number', qty:'Qty used', photo:'Photo' };
const PHOTO_FIELD = 'fldEcNp6pnrOaYErL'; // Work Log → Photo (attachments)

// "Max" target per part number (how many they want on the shelf) — from the warehouse sheet
const MAXBYNUM = {"7052":15,"5873":12,"5877":5,"6161":10,"DA1175-FI":8,"4580":12,"4585":8,"DA1173-CB":4,"3635":25,"~0044":4,"8164":10,"JazzHolder":10,"DA1254-HUB":4,"DA1236UHB":10,"DA-m-0018-CST":10,"DA1153-S":6,"MGT-2450":4,"DA-M-0018-DD":2,"DA-M-0018-CSM 30K":3,"DA-M-0018-CFM 25K":1,"432T":10,"4421":4,"4425":4,"8631":2,"8959":8,"3600":6,"3640":4,"5150":8,"DA1284-5":0,"5660":15,"7795543":4,"5670":10,"8688":6,"8890":6,"7350":15,"4430":4,"4433":4,"5948":4,"120T":0,"9556059":10,"3637":18,"DA-M-0018-CSAEC":8,"DA1138-WH":4,"~0053":4,"6301":8,"DA1162-PC":2,"DA1172-A":1,"DA1287LID":2,"DA1278-Base":2,"5811":2,"5171":10,"DA0018-SOL":3,"2110":1,"P31-07E":2,"~0052":0,"AE-23":0,"P31-16":1,"S611R":40,"432R":0,"DA1340FE":0,"DA1345-SH":0,"8941":6,"JazzExt Cable":0,"G1429075":2,"G210375001":0,"G0321422":0,"9963659":0,"DA1178-CMSV":0,"DA1178-MSV":0,"9559097":14,"733":40,"Jazzext C-C":8,"8136":10,"8943":10,"DA1231-CBB":6,"7784806":10,"C Hub":5,"703":10,"0123":8,"7012":0};
const PT = { name:'Part name', number:'Part number', stock:'In warehouse', reorderAt:'Reorder at',
             bin:'Bin', vendor:'Vendor', lastOrdered:'Last ordered', onOrder:'On order qty', orderDate:'Order date', max:'Max' };
const OF = { office:'Office', ops:'Ops', areas:'Area names', notes:'Notes' };
const AS = { number:'Asset Number', location:'Location', asset:'Asset', serial:'Serial Number',
             model:'Make/Model', date:'Manufacture Date', maker:'Manufacturer', office:'Office' };

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
      const assets = await fetchAll(ASSETS, headers, '');
      // Live office list = union of Offices table + any office found on assets or problems
      var offSet = {};
      offices.forEach(function(o){ var n=String((o.fields[OF.office]||'')).trim(); if(n) offSet[n]=true; });
      assets.forEach(function(a){ var n=String((a.fields[AS.office]||'')).trim(); if(n) offSet[n]=true; });
      issues.forEach(function(i){ var n=String((i.fields[P.office]||'')).trim(); if(n) offSet[n]=true; });
      var officeList = Object.keys(offSet).sort();
      return resp(200, {
        build: 'v2026.06.29-crew',
        issues: issues.map(mapIssue),
        worklog: log.map(mapLog),
        parts: parts.map(mapPart),
        offices: offices.map(mapOffice),
        assets: assets.map(mapAsset),
        officeList: officeList
      });
    }
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (b.action === 'add')    return resp(200, await addIssue(b, headers));
      if (b.action === 'status') return resp(200, await setStatus(b, headers));
      if (b.action === 'note')   return resp(200, await addNote(b, headers));
      if (b.action === 'order')  return resp(200, await orderPart(b, headers));
      if (b.action === 'receive')return resp(200, await receivePart(b, headers));
      if (b.action === 'adjust') return resp(200, await adjustPart(b, headers));
      if (b.action === 'addpart')return resp(200, await addPart(b, headers));
      if (b.action === 'addoffice')return resp(200, await addOffice(b, headers));
      if (b.action === 'addasset')return resp(200, await addAssets(b, headers));
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
function mapPart(r){ var f=r.fields; var s=f[PT.stock], ra=f[PT.reorderAt];
  var mx=f[PT.max]; if(mx==null) mx=MAXBYNUM[f[PT.number]];
  return {
  id:r.id, name:f[PT.name]||'', number:f[PT.number]||'', inStock:(s==null?'':s), reorderAt:(ra==null?'':ra),
  max:(mx==null?'':mx), bin:f[PT.bin]||'', vendor:f[PT.vendor]||'', lastOrdered:f[PT.lastOrdered]||'',
  onOrder:(f[PT.onOrder]==null?0:f[PT.onOrder]), orderDate:f[PT.orderDate]||'',
  orderNow:(typeof s==='number' && typeof ra==='number' && s<=ra) }; }
function mapOffice(r){ var f=r.fields; return {
  id:r.id, office:f[OF.office]||'', ops:(f[OF.ops]==null?'':f[OF.ops]), areas:f[OF.areas]||'', notes:f[OF.notes]||'' }; }

function mapAsset(r){ var f=r.fields; return {
  id:r.id, number:f[AS.number]||'', location:f[AS.location]||'', asset:f[AS.asset]||'',
  serial:f[AS.serial]||'', model:f[AS.model]||'', date:f[AS.date]||'', maker:f[AS.maker]||'', office:f[AS.office]||'' }; }

// Critical equipment is always High priority, no matter what the reporter picked.
// A down compressor / vacuum / autoclave can stop a whole office.
var AUTO_HIGH = /(compressor|vacuum|\bvac\b|autoclave|sterilizer|steriliz)/i;
function autoHighImpact(b){
  var text = ((b.problem || '') + ' ' + (b.chair || ''));
  if (AUTO_HIGH.test(text)) return 'high';
  return b.impact || '';
}

async function addIssue(b, headers){
  var fields = {};
  fields[P.problem]  = b.problem || '';
  fields[P.office]   = b.office || '';
  fields[P.chair]    = b.chair || '';
  var impact = autoHighImpact(b);
  if (impact) fields[P.urgency] = cap(impact);
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

// find a Part by its part number and subtract qty from In warehouse (never below 0)
async function usePart(number, qty, headers){
  var rec = await findPart(number, headers);
  if (!rec) return { matched:false, message:'No part with number ' + number };
  var current = rec.fields[PT.stock];
  var next = Math.max((typeof current === 'number' ? current : 0) - qty, 0);
  var fields = {}; fields[PT.stock] = next;
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { matched:true, remaining:next };
}

async function findPart(number, headers){
  var formula = "{" + PT.number + "} = '" + esc(number) + "'";
  var found = await fetchAll(PARTS, headers, formula);
  return found.length ? found[0] : null;
}

// mark a part as ordered: store qty + today's date
async function orderPart(b, headers){
  var rec = await findPart(String(b.number || '').trim(), headers);
  if (!rec) return { ok:false, matched:false };
  var qty = Number(b.qty || 0); if (qty < 0) qty = 0;
  var fields = {}; fields[PT.onOrder] = qty; fields[PT.orderDate] = today();
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, matched:true, onOrder:qty, orderDate:today() };
}

// receive an order: add the on-order qty into stock, clear the on-order qty (keep date as last-ordered)
async function receivePart(b, headers){
  var rec = await findPart(String(b.number || '').trim(), headers);
  if (!rec) return { ok:false, matched:false };
  var current = rec.fields[PT.stock]; current = (typeof current === 'number' ? current : 0);
  var onOrder = rec.fields[PT.onOrder]; onOrder = (typeof onOrder === 'number' ? onOrder : 0);
  var next = current + onOrder;
  var fields = {}; fields[PT.stock] = next; fields[PT.onOrder] = 0;
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, matched:true, remaining:next, received:onOrder };
}

// adjust on-hand count to an exact number (corrections / receiving without an order)
async function adjustPart(b, headers){
  var rec = await findPart(String(b.number || '').trim(), headers);
  if (!rec) return { ok:false, matched:false };
  var val = Number(b.inStock); if (isNaN(val) || val < 0) val = 0;
  var fields = {}; fields[PT.stock] = Math.round(val);
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, matched:true, remaining:Math.round(val) };
}

// create a brand-new part in the warehouse
async function addPart(b, headers){
  var number = String(b.number || '').trim();
  var name   = String(b.name || '').trim();
  if (!number || !name) return { ok:false, error:'Part number and name are required.' };
  var existing = await findPart(number, headers);
  if (existing) return { ok:false, error:'A part with number ' + number + ' already exists.' };
  var fields = {};
  fields[PT.name]   = name;
  fields[PT.number] = number;
  if (b.bin)    fields[PT.bin] = String(b.bin).trim();
  if (b.vendor) fields[PT.vendor] = String(b.vendor).trim();
  fields[PT.stock]     = Math.max(Math.round(Number(b.inStock) || 0), 0);
  fields[PT.reorderAt] = Math.max(Math.round(Number(b.reorderAt) || 0), 0);
  if (b.max !== '' && b.max != null && !isNaN(Number(b.max))) fields[PT.max] = Math.max(Math.round(Number(b.max)), 0);
  var r = await fetch(API + '/' + PARTS, { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  return { ok:true, id:j.id };
}

// create a new office row in the Offices table (so an office can exist before it has equipment)
async function addOffice(b, headers){
  var name = String(b.office || '').trim();
  if (!name) return { ok:false, error:'Office name is required.' };
  var existing = await fetchAll(OFFICES, headers, "{" + OF.office + "} = '" + esc(name) + "'");
  if (existing.length) return { ok:false, error:'An office named ' + name + ' already exists.' };
  var fields = {}; fields[OF.office] = name;
  var r = await fetch(API + '/' + OFFICES, { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  return { ok:true, id:j.id, office:name };
}

// create one or many asset rows in the Assets table (batched 10 per request)
async function addAssets(b, headers){
  var rows = Array.isArray(b.assets) ? b.assets : [];
  var recs = [];
  rows.forEach(function(a){
    var f = {};
    if (a.office)   f[AS.office]   = String(a.office).trim();
    if (a.location) f[AS.location] = String(a.location).trim();
    if (a.number)   f[AS.number]   = String(a.number).trim();
    if (a.asset)    f[AS.asset]    = String(a.asset).trim();
    if (a.serial)   f[AS.serial]   = String(a.serial).trim();
    if (a.model)    f[AS.model]    = String(a.model).trim();
    if (a.date)     f[AS.date]     = String(a.date).trim();
    if (a.maker)    f[AS.maker]    = String(a.maker).trim();
    if (Object.keys(f).length) recs.push({ fields:f });
  });
  if (!recs.length) return { ok:false, error:'No equipment to add.' };
  var created = 0;
  for (var i=0;i<recs.length;i+=10){
    var chunk = recs.slice(i,i+10);
    var r = await fetch(API + '/' + ASSETS, { method:'POST', headers:headers, body: JSON.stringify({ records:chunk, typecast:true }) });
    if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
    var j = await r.json();
    created += (j.records || []).length;
  }
  return { ok:true, created:created };
}
