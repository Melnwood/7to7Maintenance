// 7to7 Maintenance — Airtable proxy (Netlify Function)
// BUILD: v2026.07.02-scanphoto
// Token lives ONLY in Netlify (env var AIRTABLE_TOKEN). Browser never sees it.

const BASE_ID  = 'appGs7g0INHR4zicv';
const PROBLEMS = 'tblEPLcgnxd8JLNCQ';
const WORKLOG  = 'tblrETFLBC86UP7dd';
const PARTS    = 'tblGjZycgUCNxSdY0';
const OFFICES  = 'tblQtsQmJuoRvbT2q';
const ASSETS   = 'tbl313FCS3qRDNAmc';
const POS      = encodeURIComponent('Purchase Orders');
const API = 'https://api.airtable.com/v0/' + BASE_ID;

const P  = { problem:'Problem', office:'Office', chair:'Chair/Area', urgency:'Urgency',
             status:'Status', reporter:'Reported by', reported:'Reported', fixed:'Date fixed', history:'History' };
const W  = { entry:'Entry', problemId:'Problem ID', date:'Date', who:'Who', note:'Note',
             partNumber:'Part number', qty:'Qty used', photo:'Photo', reportedOn:'Reported on' };
const PHOTO_FIELD = 'fldEcNp6pnrOaYErL'; // Work Log → Photo (attachments)
const VISION_MODEL = 'claude-haiku-4-5-20251001'; // reads package labels; cheap + fast. Swap to claude-sonnet-4-6 for hard invoices.

// "Max" target per part number (how many they want on the shelf) — from the warehouse sheet
const MAXBYNUM = {"7052":15,"5873":12,"5877":5,"6161":10,"DA1175-FI":8,"4580":12,"4585":8,"DA1173-CB":4,"3635":25,"~0044":4,"8164":10,"JazzHolder":10,"DA1254-HUB":4,"DA1236UHB":10,"DA-m-0018-CST":10,"DA1153-S":6,"MGT-2450":4,"DA-M-0018-DD":2,"DA-M-0018-CSM 30K":3,"DA-M-0018-CFM 25K":1,"432T":10,"4421":4,"4425":4,"8631":2,"8959":8,"3600":6,"3640":4,"5150":8,"DA1284-5":0,"5660":15,"7795543":4,"5670":10,"8688":6,"8890":6,"7350":15,"4430":4,"4433":4,"5948":4,"120T":0,"9556059":10,"3637":18,"DA-M-0018-CSAEC":8,"DA1138-WH":4,"~0053":4,"6301":8,"DA1162-PC":2,"DA1172-A":1,"DA1287LID":2,"DA1278-Base":2,"5811":2,"5171":10,"DA0018-SOL":3,"2110":1,"P31-07E":2,"~0052":0,"AE-23":0,"P31-16":1,"S611R":40,"432R":0,"DA1340FE":0,"DA1345-SH":0,"8941":6,"JazzExt Cable":0,"G1429075":2,"G210375001":0,"G0321422":0,"9963659":0,"DA1178-CMSV":0,"DA1178-MSV":0,"9559097":14,"733":40,"Jazzext C-C":8,"8136":10,"8943":10,"DA1231-CBB":6,"7784806":10,"C Hub":5,"703":10,"0123":8,"7012":0};
const PT = { name:'Part name', number:'Part number', stock:'In warehouse', reorderAt:'Reorder at',
             bin:'Bin', vendor:'Vendor', lastOrdered:'Last ordered', onOrder:'On order qty', orderDate:'Order date', max:'Max', cost:'Unit cost', netsuiteItem:'NetSuite Item' };
const OF = { office:'Office', ops:'Ops', areas:'Area names', notes:'Notes', showCompleted:'Show completed' };
const AS = { number:'Asset Number', location:'Location', asset:'Asset', serial:'Serial Number',
             model:'Make/Model', date:'Manufacture Date', maker:'Manufacturer', office:'Office', status:'Status', lifeOverride:'Life override' };
// Purchase Orders — one row per PO line. PO Ref groups lines into one PO; NetSuite numbers it on import.
const PO = { label:'Name', ref:'PO Ref', date:'Date', vendor:'Vendor', clinic:'Clinic',
             partNumber:'Part number', partName:'Part name', qty:'Quantity', rate:'Rate', memo:'Notes',
             description:'Description', receiveBy:'Receive by', taxRate:'Tax rate %',
             amount:'Amount', taxAmount:'Tax amount', lineTotal:'Line total' };

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
      // Equipment Life = small Adrian-editable table (Category, Years). Optional — falls back to [] if absent.
      var life = [];
      try { life = (await fetchAll('Equipment%20Life', headers, '')).map(mapLife); } catch(e){ life = []; }
      // People = small Adrian-editable crew list (Name, Active). Optional — falls back to [] if absent.
      var people = [];
      try { people = (await fetchAll('People', headers, '')).map(mapPerson); } catch(e){ people = []; }
      // Time Log = labor sessions (Start/End per work order). Optional — falls back to [] if absent.
      var timelog = [];
      try { timelog = (await fetchAll('Time%20Log', headers, '')).map(mapTime); } catch(e){ timelog = []; }
      // Purchase Orders = PO lines created in-app, exported to NetSuite. Optional — falls back to [] if absent.
      var pos = [];
      try { pos = (await fetchAll(POS, headers, '')).map(mapPO); } catch(e){ pos = []; }
      // Live office list = union of Offices table + any office found on assets or problems
      var offSet = {};
      offices.forEach(function(o){ var n=String((o.fields[OF.office]||'')).trim(); if(n) offSet[n]=true; });
      assets.forEach(function(a){ var n=String((a.fields[AS.office]||'')).trim(); if(n) offSet[n]=true; });
      issues.forEach(function(i){ var n=String((i.fields[P.office]||'')).trim(); if(n) offSet[n]=true; });
      var officeList = Object.keys(offSet).sort();
      return resp(200, {
        build: 'v2026.07.02-scanphoto',
        issues: issues.map(mapIssue),
        worklog: log.map(mapLog),
        parts: parts.map(mapPart),
        offices: offices.map(mapOffice),
        assets: assets.map(mapAsset),
        life: life,
        people: people,
        timelog: timelog,
        purchaseorders: pos,
        officeList: officeList
      });
    }
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (b.action === 'add')    return resp(200, await addIssue(b, headers));
      if (b.action === 'status') return resp(200, await setStatus(b, headers));
      if (b.action === 'deleterequest') return resp(200, await deleteRequest(b, headers));
      if (b.action === 'urgency')return resp(200, await setUrgency(b, headers));
      if (b.action === 'notdupe')return resp(200, await markNotDupe(b, headers));
      if (b.action === 'note')   return resp(200, await addNote(b, headers));
      if (b.action === 'order')  return resp(200, await orderPart(b, headers));
      if (b.action === 'receive')return resp(200, await receivePart(b, headers));
      if (b.action === 'adjust') return resp(200, await adjustPart(b, headers));
      if (b.action === 'editpart')return resp(200, await editPart(b, headers));
      if (b.action === 'addpart')return resp(200, await addPart(b, headers));
      if (b.action === 'addoffice')return resp(200, await addOffice(b, headers));
      if (b.action === 'editoffice')return resp(200, await editOffice(b, headers));
      if (b.action === 'addperson')return resp(200, await addPerson(b, headers));
      if (b.action === 'deactivateperson')return resp(200, await deactivatePerson(b, headers));
      if (b.action === 'startwork')return resp(200, await startWork(b, headers));
      if (b.action === 'endwork')  return resp(200, await endWork(b, headers));
      if (b.action === 'addasset')return resp(200, await addAssets(b, headers));
      if (b.action === 'editasset')return resp(200, await editAsset(b, headers));
      if (b.action === 'createpo')return resp(200, await createPO(b, headers));
      if (b.action === 'markreported')return resp(200, await markReported(b, headers));
      if (b.action === 'setallcompleted')return resp(200, await setAllCompleted(b, headers));
      if (b.action === 'scanlabel') return resp(200, await scanLabel(b, headers));
      if (b.action === 'receiveqty')return resp(200, await receiveQty(b, headers));
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
function mapLife(r){ var f=r.fields; var y=f['Years'];
  return { category:String(f['Category']||'').trim(), years:(y==null||y===''?null:Number(y)) }; }
function mapPerson(r){ var f=r.fields; var act=f['Active'];
  return { id:r.id, name:String(f['Name']||'').trim(), active:(act===undefined?true:!!act) }; }
function mapTime(r){ var f=r.fields;
  return { id:r.id, problemId:String(f['Problem ID']||'').trim(), office:String(f['Office']||'').trim(),
    chair:String(f['Chair/Area']||'').trim(), who:String(f['Who']||'').trim(),
    start:f['Start']||'', end:f['End']||'' }; }
function mapLog(r){ var f=r.fields; var ph=f[W.photo]||[];
  var urls = (Array.isArray(ph)?ph:[]).map(function(a){
    return (a && ((a.thumbnails && a.thumbnails.large && a.thumbnails.large.url) || a.url)) || ''; }).filter(Boolean);
  return {
  id:r.id, issueId:f[W.problemId]||'', date:f[W.date]||'', who:f[W.who]||'', note:f[W.note]||'',
  partNumber:f[W.partNumber]||'', qty:f[W.qty]||'', reportedOn:f[W.reportedOn]||'',
  photos: urls,
  photo: urls[0] || '' }; }
function mapPart(r){ var f=r.fields; var s=f[PT.stock], ra=f[PT.reorderAt];
  var mx=f[PT.max]; if(mx==null) mx=MAXBYNUM[f[PT.number]];
  return {
  id:r.id, name:f[PT.name]||'', number:f[PT.number]||'', inStock:(s==null?'':s), reorderAt:(ra==null?'':ra),
  max:(mx==null?'':mx), bin:f[PT.bin]||'', vendor:f[PT.vendor]||'', lastOrdered:f[PT.lastOrdered]||'',
  onOrder:(f[PT.onOrder]==null?0:f[PT.onOrder]), orderDate:f[PT.orderDate]||'',
  cost:(f[PT.cost]==null?'':f[PT.cost]), netsuiteItem:f[PT.netsuiteItem]||'',
  orderNow:(typeof s==='number' && typeof ra==='number' && s<=ra) }; }
function mapOffice(r){ var f=r.fields; return {
  id:r.id, office:f[OF.office]||'', ops:(f[OF.ops]==null?'':f[OF.ops]), areas:f[OF.areas]||'', notes:f[OF.notes]||'', showCompleted:(f[OF.showCompleted]===true) }; }
function mapPO(r){ var f=r.fields; return {
  id:r.id, ref:f[PO.ref]||'', date:f[PO.date]||'', vendor:f[PO.vendor]||'', clinic:f[PO.clinic]||'',
  partNumber:f[PO.partNumber]||'', partName:f[PO.partName]||'', qty:(f[PO.qty]==null?'':f[PO.qty]),
  rate:(f[PO.rate]==null?'':f[PO.rate]), memo:f[PO.memo]||'', description:f[PO.description]||'',
  receiveBy:f[PO.receiveBy]||'', taxRate:(f[PO.taxRate]==null?'':f[PO.taxRate]),
  amount:(f[PO.amount]==null?'':f[PO.amount]), taxAmount:(f[PO.taxAmount]==null?'':f[PO.taxAmount]),
  lineTotal:(f[PO.lineTotal]==null?'':f[PO.lineTotal]) }; }

function mapAsset(r){ var f=r.fields; return {
  id:r.id, number:f[AS.number]||'', location:f[AS.location]||'', asset:f[AS.asset]||'',
  serial:f[AS.serial]||'', model:f[AS.model]||'', date:f[AS.date]||'', maker:f[AS.maker]||'', office:f[AS.office]||'', status:f[AS.status]||'', lifeOverride:(f[AS.lifeOverride]==null?'':f[AS.lifeOverride]) }; }

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
  if (impact === 'high') fields[P.urgency] = 'High';        // critical equipment is always High
  else if (b.urgency) fields[P.urgency] = b.urgency;        // manager picked a level explicitly
  else if (impact) fields[P.urgency] = cap(impact);         // office report's impact choice
  fields[P.reporter] = b.reporter || '';
  fields[P.status]   = b.status || 'New';                   // manager can file it straight into a stage
  fields[P.reported] = today();
  var r = await fetch(API + '/' + PROBLEMS, { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  var out = { ok:true, id:j.id };
  // total requests so far — the report page uses this to advance the thank-you message one step per submit
  try { out.count = (await fetchAll(PROBLEMS, headers, '')).length; } catch(e){ /* non-fatal */ }
  // optional initial note (manager work orders often carry a detail to keep on record)
  if (b.note){ try { await logWork({ problemId:j.id, who:b.reporter||'', note:b.note }, headers); } catch(e){} }
  // optional photos from the reporter — ride them in on an initial Work Log entry (non-fatal)
  var newPics = photoList(b);
  if (newPics.length){
    try {
      var wlId = await logWork({ problemId:j.id, who:b.reporter||'', note:(newPics.length>1?'Photos':'Photo')+' from reporter' }, headers);
      var upN = await uploadPhotos(wlId, newPics, headers);
      out.photos = upN.uploaded; out.photosFailed = upN.failed; out.photo = upN.uploaded > 0;
      if (upN.failed) out.photoError = upN.error;
    } catch (e){ out.photo = false; out.photoError = String((e && e.message) || e); }
  }
  return out;
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

// permanently delete a request (manager side only). Also removes any work-log entries tied to it, so nothing is orphaned.
async function deleteRequest(b, headers){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No request id.' };
  var removedLogs = 0;
  try {
    var logs = await fetchAll(WORKLOG, headers, "{" + W.problemId + "} = '" + esc(id) + "'");
    for (var i=0;i<logs.length;i+=10){
      var chunk = logs.slice(i, i+10);
      if (!chunk.length) continue;
      var q = chunk.map(function(r){ return 'records[]=' + encodeURIComponent(r.id); }).join('&');
      var rd = await fetch(API + '/' + WORKLOG + '?' + q, { method:'DELETE', headers:headers });
      if (rd.ok) removedLogs += chunk.length;
    }
  } catch(e){}
  var r = await fetch(API + '/' + PROBLEMS + '/' + id, { method:'DELETE', headers:headers });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, id:id, removedLogs:removedLogs };
}

async function editAsset(b, headers){
  if (!b.id) return { ok:false, error:'no record id' };
  // Map only the fields Adrian actually changed onto the real Airtable column names.
  var map = { asset:AS.asset, location:AS.location, office:AS.office, model:AS.model,
              serial:AS.serial, date:AS.date, number:AS.number, maker:AS.maker, status:AS.status, lifeOverride:AS.lifeOverride };
  var fields = {};
  Object.keys(map).forEach(function(k){ if (b[k] !== undefined) fields[map[k]] = b[k]; });
  if (!Object.keys(fields).length) return { ok:false, error:'nothing to update' };
  var r = await fetch(API + '/' + ASSETS + '/' + b.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true };
}

async function setUrgency(b, headers){
  // Adrian has the final say on priority — set High / Medium / Low directly.
  var fields = {}; fields[P.urgency] = cap(b.urgency);
  var r = await fetch(API + '/' + PROBLEMS + '/' + b.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  await logWork({ problemId:b.id, who:b.who||'', note:'Priority changed to ' + cap(b.urgency) }, headers);
  return { ok:true };
}

async function markNotDupe(b, headers){
  // Persist a "not a duplicate" decision in the Work Log so it survives reloads & redeploys.
  var ids = b.ids || (b.key ? String(b.key).split(',') : []);
  var key = b.key || ids.join(',');
  var anchor = ids[0] || '';
  if (!anchor) return { ok:false, error:'no record id' };
  await logWork({ problemId: anchor, who: b.who || '', note: 'Reviewed \u2014 not a duplicate [dupe-key:' + key + ']' }, headers);
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
  // attach any photos to the primary row (non-fatal — a failed upload never loses the note)
  var pics = photoList(b);
  if (pics.length && primaryId){
    var up = await uploadPhotos(primaryId, pics, headers);
    out.photos = up.uploaded;
    out.photosFailed = up.failed;
    out.photo = up.uploaded > 0;
    if (up.failed) out.photoError = up.error;
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

// normalize whatever the client sent into a list of {base64,type,name}
function photoList(b){
  var list = [];
  if (Array.isArray(b.photos)){
    b.photos.forEach(function(p){
      if (!p) return;
      var data = (typeof p === 'string') ? p : p.base64;
      if (!data) return;
      list.push({ base64:data, type:(p && p.type) || 'image/jpeg', name:(p && p.name) || 'photo.jpg' });
    });
  }
  if (!list.length && b.photo) list.push({ base64:b.photo, type:b.photoType||'image/jpeg', name:b.photoName||'photo.jpg' });
  return list.slice(0, 10); // sane cap per work-log entry
}

// upload every photo onto one Work Log row (attachments accumulate, so send them one at a time)
async function uploadPhotos(recordId, list, headers){
  var done = 0, failed = 0, lastErr = '';
  for (var i = 0; i < list.length; i++){
    try { await uploadPhoto(recordId, list[i].base64, list[i].type, list[i].name, headers); done++; }
    catch (e){ failed++; lastErr = String((e && e.message) || e); }
  }
  return { uploaded:done, failed:failed, error:lastErr };
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

// ---- Receive by photo: read a package label / invoice line, match it to a part ----
function _normNum(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function _safeJSON(t){
  if(!t) return null;
  var s = String(t).replace(/```json/gi,'').replace(/```/g,'').trim();
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if(a>=0 && b>a) s = s.slice(a, b+1);
  try { return JSON.parse(s); } catch(e){ return null; }
}
function _matchParts(ex, parts){
  var exNum = _normNum(ex && ex.partNumber);
  var exName = String((ex && ex.partName) || '').toLowerCase();
  var nameToks = exName.split(/[^a-z0-9]+/).filter(function(w){ return w.length>2; });
  var scored = parts.map(function(p){
    var pn = _normNum(p.number), score = 0;
    if(exNum && pn){
      if(pn===exNum) score = 100;
      else if((pn.indexOf(exNum)>=0 || exNum.indexOf(pn)>=0) && Math.min(pn.length,exNum.length)>=4) score = 78;
    }
    if(nameToks.length && p.name){
      var b = p.name.toLowerCase().split(/[^a-z0-9]+/).filter(function(w){ return w.length>2; });
      var common = nameToks.filter(function(w){ return b.indexOf(w)>=0; }).length;
      if(common) score = Math.max(score, Math.min(65, 20 + common*16));
    }
    return { p:p, score:score };
  }).filter(function(x){ return x.score>0; }).sort(function(a,b){ return b.score-a.score; }).slice(0,5);
  return scored.map(function(x){ return { id:x.p.id, number:x.p.number, name:x.p.name, inStock:x.p.inStock, bin:x.p.bin, score:x.score }; });
}
async function _callVision(imageB64, mediaType, prompt){
  var key = process.env.ANTHROPIC_API_KEY;
  if(!key) return { error:'Photo reading is not set up yet: add ANTHROPIC_API_KEY in Netlify.' };
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':key, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL, max_tokens: 400,
      messages:[{ role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:(mediaType||'image/jpeg'), data:imageB64 } },
        { type:'text', text:prompt }
      ]}]
    })
  });
  if(!r.ok) return { error:'Vision API ' + r.status + ': ' + (await r.text()).slice(0,180) };
  var jj = await r.json();
  var text = (jj.content||[]).filter(function(c){ return c.type==='text'; }).map(function(c){ return c.text; }).join('\n');
  return { text:text };
}
async function scanLabel(b, headers){
  var img = b.image; if(!img) return { ok:false, error:'No photo received.' };
  var prompt = 'This is a phone photo of a parts package label or an invoice line, for dental/veterinary equipment maintenance. '
    + 'Read what you can. Respond with ONLY a JSON object and nothing else (no prose, no code fences). '
    + 'Keys: partNumber (the manufacturer/vendor part number or SKU printed on it, best single guess, else ""), '
    + 'partName (the item name/description, else ""), vendor (brand or supplier if shown, else ""), '
    + 'quantity (integer count of units if clearly shown, else null). If unreadable use empty strings and null.';
  var v = await _callVision(img, b.imageType, prompt);
  if(v.error) return { ok:false, error:v.error };
  var ex = _safeJSON(v.text) || {};
  var parts = (await fetchAll(PARTS, headers, '')).map(mapPart);
  var matches = _matchParts(ex, parts);
  return { ok:true,
    extracted:{ partNumber:(ex.partNumber||''), partName:(ex.partName||''), vendor:(ex.vendor||''), quantity:(ex.quantity==null?'':ex.quantity) },
    matches:matches };
}
// add a received quantity onto a part's on-hand count (by record id, or by number)
async function receiveQty(b, headers){
  var rec = null;
  if(b.id){ var r0 = await fetch(API + '/' + PARTS + '/' + b.id, { headers:headers }); if(r0.ok) rec = await r0.json(); }
  if(!rec) rec = await findPart(String(b.number || '').trim(), headers);
  if(!rec) return { ok:false, matched:false };
  var qty = Math.round(Number(b.qty)||0);
  if(qty <= 0) return { ok:false, error:'Enter how many arrived.' };
  var cur = rec.fields[PT.stock]; cur = (typeof cur==='number' ? cur : 0);
  var next = cur + qty;
  var fields = {}; fields[PT.stock] = next;
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if(!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, matched:true, id:rec.id, number:(rec.fields[PT.number]||''), added:qty, remaining:next };
}

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
// update any of a part's fields. Prefers record id (so the part NUMBER can be changed safely); falls back to lookup by number.
async function editPart(b, headers){
  var rec = null;
  if (b.id){
    var r0 = await fetch(API + '/' + PARTS + '/' + b.id, { headers:headers });
    if (r0.ok) rec = await r0.json();
  }
  if (!rec) rec = await findPart(String(b.number || '').trim(), headers);
  if (!rec) return { ok:false, matched:false };
  var fields = {};
  if (b.name !== undefined && String(b.name).trim() !== '') fields[PT.name] = String(b.name).trim();
  if (b.number !== undefined && String(b.number).trim() !== ''){
    var newNum = String(b.number).trim();
    if (newNum !== (rec.fields[PT.number] || '')){
      var clash = await findPart(newNum, headers);
      if (clash && clash.id !== rec.id) return { ok:false, error:'Another part already uses number ' + newNum + '.' };
    }
    fields[PT.number] = newNum;
  }
  if (b.vendor !== undefined)       fields[PT.vendor] = String(b.vendor || '').trim();
  if (b.bin !== undefined)          fields[PT.bin] = String(b.bin || '').trim();
  if (b.netsuiteItem !== undefined) fields[PT.netsuiteItem] = String(b.netsuiteItem || '').trim();
  if (b.reorderAt !== undefined && b.reorderAt !== null && b.reorderAt !== '') fields[PT.reorderAt] = Math.max(Math.round(Number(b.reorderAt)||0),0);
  if (b.max !== undefined && b.max !== null && b.max !== '') fields[PT.max] = Math.max(Math.round(Number(b.max)||0),0);
  if (b.inStock !== undefined && b.inStock !== null && b.inStock !== '') fields[PT.stock] = Math.max(Math.round(Number(b.inStock)||0),0);
  if (b.cost === '') fields[PT.cost] = null;
  else if (b.cost !== undefined && b.cost !== null) fields[PT.cost] = Math.max(Number(b.cost)||0,0);
  if (!Object.keys(fields).length) return { ok:false, error:'Nothing to update.' };
  var r = await fetch(API + '/' + PARTS + '/' + rec.id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, matched:true, id:rec.id, number:(fields[PT.number] || rec.fields[PT.number] || '') };
}

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

// update an existing office's chair count / area names / notes (Manage → tap an office → edit)
async function editOffice(b, headers){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No office id.' };
  var fields = {};
  if (b.ops !== undefined){
    if (b.ops === '' || b.ops === null) fields[OF.ops] = null;
    else fields[OF.ops] = Math.max(Math.round(Number(b.ops) || 0), 0);
  }
  if (b.areas !== undefined) fields[OF.areas] = String(b.areas || '').trim();
  if (b.notes !== undefined) fields[OF.notes] = String(b.notes || '').trim();
  if (b.showCompleted !== undefined) fields[OF.showCompleted] = !!b.showCompleted;
  if (!Object.keys(fields).length) return { ok:false, error:'Nothing to update.' };
  var r = await fetch(API + '/' + OFFICES + '/' + id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, id:id };
}

// Master on/off — flip "Show completed" for every office at once.
async function setAllCompleted(b, headers){
  var val = !!b.value;
  var offices = await fetchAll(OFFICES, headers, '');
  var ids = offices.map(function(o){ return o.id; });
  for (var i = 0; i < ids.length; i += 10){
    var recs = ids.slice(i, i+10).map(function(id){ var f={}; f[OF.showCompleted]=val; return { id:id, fields:f }; });
    var r = await fetch(API + '/' + OFFICES, { method:'PATCH', headers:headers, body: JSON.stringify({ records:recs, typecast:true }) });
    if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  }
  return { ok:true, count:ids.length, value:val };
}

// clock in: start an office visit (records office + who + the moment)
async function startWork(b, headers){
  var when = b.when || new Date().toISOString();
  var who = String(b.who||'').trim();
  // If they never clocked out of the last office, close it at this clock-in time.
  // Keeps hours honest instead of leaving a session running all night.
  var closed = [];
  if (who){
    try {
      var open = await fetchAll('Time%20Log', headers, "AND({Who} = '" + esc(who) + "', {End} = BLANK())");
      for (var i = 0; i < open.length; i++){
        try {
          await fetch(API + '/' + encodeURIComponent('Time Log') + '/' + open[i].id, {
            method:'PATCH', headers:headers,
            body: JSON.stringify({ fields:{ 'End': when }, typecast:true }) });
          closed.push({ id:open[i].id, office:String((open[i].fields||{})['Office']||'').trim(), end:when });
        } catch(e){ /* non-fatal — never block the new clock-in */ }
      }
    } catch(e){ /* Time Log missing or query failed — carry on */ }
  }
  var fields = { 'Office': String(b.office||'').trim(), 'Who': who, 'Start': when };
  var r = await fetch(API + '/' + encodeURIComponent('Time Log'), { method:'POST', headers:headers, body: JSON.stringify({ fields:fields, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  return { ok:true, id:j.id, start:when, closed:closed };
}
// close a labor session (stamp the end time on an existing Time Log row)
async function endWork(b, headers){
  var id = String(b.id||'').trim();
  if (!id) return { ok:false, error:'No open session id.' };
  var when = b.when || new Date().toISOString();
  var r = await fetch(API + '/' + encodeURIComponent('Time Log') + '/' + id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:{ 'End': when }, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, id:id, end:when };
}

// add a crew member to the People table (Adrian self-serves from the Manage tab)
async function addPerson(b, headers){
  var name = String(b.name || '').trim();
  if (!name) return { ok:false, error:'Name is required.' };
  var r = await fetch(API + '/' + encodeURIComponent('People'), { method:'POST', headers:headers, body: JSON.stringify({ fields:{ Name:name, Active:true }, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  var j = await r.json();
  return { ok:true, id:j.id, name:name };
}

// take a crew member off the active list (sets Active = false; keeps their name on past work)
async function deactivatePerson(b, headers){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No person id.' };
  var r = await fetch(API + '/' + encodeURIComponent('People') + '/' + id, { method:'PATCH', headers:headers, body: JSON.stringify({ fields:{ Active:false }, typecast:true }) });
  if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
  return { ok:true, id:id };
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

// create a purchase order: writes one row per line to the Purchase Orders table, tied together by a PO Ref
async function createPO(b, headers){
  var vendor = String(b.vendor || '').trim();
  var clinic = String(b.clinic || '').trim();
  var memo   = String(b.memo || '').trim();
  var date   = String(b.date || '').trim() || today();
  var lines  = Array.isArray(b.lines) ? b.lines : [];
  if (!vendor) return { ok:false, error:'Vendor is required.' };
  if (!clinic) return { ok:false, error:'Clinic is required.' };
  var clean = lines.filter(function(l){ return l && String(l.number||'').trim() && Number(l.qty) > 0; });
  if (!clean.length) return { ok:false, error:'Add at least one part with a quantity.' };
  // PO Ref: PO-YYYYMMDD-#### (last 4 of the timestamp keeps it unique within a day)
  var ref = String(b.ref || '').trim() || ('PO-' + date.replace(/-/g,'') + '-' + String(Date.now()).slice(-4));
  var taxRate = (b.taxRate !== '' && b.taxRate != null && !isNaN(Number(b.taxRate))) ? Number(b.taxRate) : null;
  var receiveBy = String(b.receiveBy || '').trim();
  var recs = clean.map(function(l){
    var f = {};
    f[PO.label]      = ref + ' \u00b7 ' + String(l.name||l.number).trim() + ' \u00d7' + Math.round(Number(l.qty));
    f[PO.ref]        = ref;
    f[PO.date]       = date;
    f[PO.vendor]     = vendor;
    f[PO.clinic]     = clinic;
    f[PO.partNumber] = String(l.number).trim();
    f[PO.partName]   = String(l.name||'').trim();
    f[PO.qty]        = Math.round(Number(l.qty));
    if (l.rate !== '' && l.rate != null && !isNaN(Number(l.rate))) f[PO.rate] = Number(l.rate);
    if (taxRate != null) f[PO.taxRate] = taxRate;
    if (receiveBy) f[PO.receiveBy] = receiveBy;
    if (l.description) f[PO.description] = String(l.description).trim();
    if (memo) f[PO.memo] = memo;
    return { fields:f };
  });
  var created = 0;
  for (var i=0;i<recs.length;i+=10){
    var chunk = recs.slice(i,i+10);
    var r = await fetch(API + '/' + POS, { method:'POST', headers:headers, body: JSON.stringify({ records:chunk, typecast:true }) });
    if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
    var j = await r.json();
    created += (j.records || []).length;
  }
  return { ok:true, ref:ref, lines:created };
}

// stamp used-part entries as reported (advances the watermark), or clear them (undo) when b.clear is set
async function markReported(b, headers){
  var ids = Array.isArray(b.ids) ? b.ids : [];
  if (!ids.length) return { ok:false, error:'No entries to mark.' };
  var date = String(b.date || '').trim() || today();
  var clear = !!b.clear;
  var n = 0;
  for (var i=0;i<ids.length;i+=10){
    var chunk = ids.slice(i,i+10).map(function(id){ var f={}; f[W.reportedOn] = clear ? null : date; return { id:id, fields:f }; });
    var r = await fetch(API + '/' + WORKLOG, { method:'PATCH', headers:headers, body: JSON.stringify({ records:chunk, typecast:true }) });
    if (!r.ok) throw new Error('Airtable ' + r.status + ': ' + (await r.text()));
    var j = await r.json(); n += (j.records || []).length;
  }
  return { ok:true, marked:n, cleared:clear };
}
