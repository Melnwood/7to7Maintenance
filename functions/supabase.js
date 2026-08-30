// 7to7 Maintenance — Supabase backend (Netlify Function)
// PARALLEL / PREVIEW function — runs alongside functions/airtable.js without touching it.
// Nothing in production points at this yet; it exists so the new Supabase-backed
// multi-tenant setup (org + membership + RLS) can be tested end-to-end before cutover.
//
// Auth model: the browser signs in via Supabase magic link and sends its session's
// access token on every request as `Authorization: Bearer <token>`. This function
// forwards that same token on every call it makes to Postgres (via the REST/PostgREST
// API), so Row Level Security — not this code — is what actually enforces that a
// contractor only ever sees their own organization's data. This function never uses a
// service-role key, so it can never see across tenants even if there were a bug here.
//
// Required Netlify env vars:
//   SUPABASE_URL       — e.g. https://ooxwogluloylimskwiwo.supabase.co
//   SUPABASE_ANON_KEY   — the project's anon/publishable key (safe to be public)
//   ANTHROPIC_API_KEY   — reused for the receive-by-photo label scan (same as airtable.js)
//
// Known interim limitation: photo uploads are stored as base64 data URIs inside the
// `photos` jsonb column (no Supabase Storage integration yet). Fine for testing; not
// meant to stay this way once real usage starts — file storage is separate follow-up work.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const VISION_MODEL = 'claude-haiku-4-5-20251001';

// "Max" target per part number (how many they want on the shelf) — from the warehouse sheet.
// Only used as a fallback when a part's max_qty column is empty.
const MAXBYNUM = {"7052":15,"5873":12,"5877":5,"6161":10,"DA1175-FI":8,"4580":12,"4585":8,"DA1173-CB":4,"3635":25,"~0044":4,"8164":10,"JazzHolder":10,"DA1254-HUB":4,"DA1236UHB":10,"DA-m-0018-CST":10,"DA1153-S":6,"MGT-2450":4,"DA-M-0018-DD":2,"DA-M-0018-CSM 30K":3,"DA-M-0018-CFM 25K":1,"432T":10,"4421":4,"4425":4,"8631":2,"8959":8,"3600":6,"3640":4,"5150":8,"DA1284-5":0,"5660":15,"7795543":4,"5670":10,"8688":6,"8890":6,"7350":15,"4430":4,"4433":4,"5948":4,"120T":0,"9556059":10,"3637":18,"DA-M-0018-CSAEC":8,"DA1138-WH":4,"~0053":4,"6301":8,"DA1162-PC":2,"DA1172-A":1,"DA1287LID":2,"DA1278-Base":2,"5811":2,"5171":10,"DA0018-SOL":3,"2110":1,"P31-07E":2,"~0052":0,"AE-23":0,"P31-16":1,"S611R":40,"432R":0,"DA1340FE":0,"DA1345-SH":0,"8941":6,"JazzExt Cable":0,"G1429075":2,"G210375001":0,"G0321422":0,"9963659":0,"DA1178-CMSV":0,"DA1178-MSV":0,"9559097":14,"733":40,"Jazzext C-C":8,"8136":10,"8943":10,"DA1231-CBB":6,"7784806":10,"C Hub":5,"703":10,"0123":8,"7012":0};

exports.handler = async function (event) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return resp(500, { error: 'Server not set up: SUPABASE_URL / SUPABASE_ANON_KEY missing in Netlify.' });
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return resp(401, { error: 'Not signed in.' });

  try {
    const user = await getUser(token);
    if (!user || !user.id) return resp(401, { error: 'Session expired. Please sign in again.' });
    const membership = await getMembership(token, user.id);
    if (!membership) return resp(403, { error: 'Your account is not linked to any organization yet.' });
    const ctx = {
      token: token,
      orgId: membership.org_id,
      role: membership.role,
      writer: membership.role === 'admin' || membership.role === 'crew',
      userId: user.id,
      email: user.email
    };

    if (event.httpMethod === 'GET') {
      const office = (event.queryStringParameters && event.queryStringParameters.office) || '';
      return resp(200, await getAll(ctx, office));
    }
    if (event.httpMethod === 'POST') {
      const b = JSON.parse(event.body || '{}');
      if (!ctx.writer) return resp(403, { error: 'Your account can view but not make changes.' });
      if (b.action === 'add')             return resp(200, await addIssue(b, ctx));
      if (b.action === 'status')          return resp(200, await setStatus(b, ctx));
      if (b.action === 'deleterequest')   return resp(200, await deleteRequest(b, ctx));
      if (b.action === 'urgency')         return resp(200, await setUrgency(b, ctx));
      if (b.action === 'notdupe')         return resp(200, await markNotDupe(b, ctx));
      if (b.action === 'note')            return resp(200, await addNote(b, ctx));
      if (b.action === 'order')           return resp(200, await orderPart(b, ctx));
      if (b.action === 'receive')         return resp(200, await receivePart(b, ctx));
      if (b.action === 'adjust')          return resp(200, await adjustPart(b, ctx));
      if (b.action === 'editpart')        return resp(200, await editPart(b, ctx));
      if (b.action === 'addpart')         return resp(200, await addPart(b, ctx));
      if (b.action === 'addoffice')       return resp(200, await addOffice(b, ctx));
      if (b.action === 'editoffice')      return resp(200, await editOffice(b, ctx));
      if (b.action === 'addperson')       return resp(200, await addPerson(b, ctx));
      if (b.action === 'deactivateperson')return resp(200, await deactivatePerson(b, ctx));
      if (b.action === 'startwork')       return resp(200, await startWork(b, ctx));
      if (b.action === 'endwork')         return resp(200, await endWork(b, ctx));
      if (b.action === 'addasset')        return resp(200, await addAssets(b, ctx));
      if (b.action === 'editasset')       return resp(200, await editAsset(b, ctx));
      if (b.action === 'createpo')        return resp(200, await createPO(b, ctx));
      if (b.action === 'markreported')    return resp(200, await markReported(b, ctx));
      if (b.action === 'setallcompleted') return resp(200, await setAllCompleted(b, ctx));
      if (b.action === 'scanlabel')       return resp(200, await scanLabel(b, ctx));
      if (b.action === 'receiveqty')      return resp(200, await receiveQty(b, ctx));
      return resp(400, { error: 'unknown action' });
    }
    return resp(405, { error: 'method not allowed' });
  } catch (e) {
    return resp(500, { error: String((e && e.message) || e) });
  }
};

function resp(code, obj){ return { statusCode: code, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(obj) }; }
function cap(s){ s=String(s||''); return s ? s.charAt(0).toUpperCase()+s.slice(1).toLowerCase() : ''; }
function today(){ return new Date().toISOString().slice(0,10); }

// ---- low-level Supabase REST (PostgREST) + Auth helpers ----

async function sb(path, opts, token){
  opts = opts || {};
  var headers = Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  }, opts.headers || {});
  var r = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers }));
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (await r.text()));
  var text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function getUser(token){
  var r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  return await r.json();
}

async function getMembership(token, userId){
  var rows = await sb('memberships?select=org_id,role&user_id=eq.' + userId + '&order=created_at.asc&limit=1', {}, token);
  return (rows && rows[0]) || null;
}

async function insertOne(table, row, token){
  var out = await sb(table, { method:'POST', headers:{ Prefer:'return=representation' }, body: JSON.stringify(row) }, token);
  return out && out[0];
}
async function insertMany(table, rows, token){
  return await sb(table, { method:'POST', headers:{ Prefer:'return=representation' }, body: JSON.stringify(rows) }, token);
}
async function updateOne(table, id, orgId, fields, token){
  var out = await sb(table + '?id=eq.' + id + '&org_id=eq.' + orgId, { method:'PATCH', headers:{ Prefer:'return=representation' }, body: JSON.stringify(fields) }, token);
  return out && out[0];
}
async function deleteOne(table, id, orgId, token){
  await sb(table + '?id=eq.' + id + '&org_id=eq.' + orgId, { method:'DELETE' }, token);
}

// ---- read everything (dashboard bootstrap) ----

async function getAll(ctx, officeFilter){
  var qs = '&org_id=eq.' + ctx.orgId;
  var problemsPath = 'problems?select=*' + qs;
  if (officeFilter) problemsPath += '&office=eq.' + encodeURIComponent(officeFilter);
  var problems = await sb(problemsPath, {}, ctx.token);
  var worklog  = await sb('work_log?select=*' + qs + '&order=log_date.desc', {}, ctx.token);
  var parts    = await sb('parts?select=*' + qs, {}, ctx.token);
  var offices  = await sb('offices?select=*' + qs, {}, ctx.token);
  var assets   = await sb('assets?select=*' + qs, {}, ctx.token);
  var life     = await sb('equipment_life?select=*' + qs, {}, ctx.token);
  var people   = await sb('people?select=*' + qs, {}, ctx.token);
  var timelog  = await sb('time_log?select=*' + qs, {}, ctx.token);
  var pos      = await sb('purchase_orders?select=*' + qs, {}, ctx.token);

  var offSet = {};
  offices.forEach(function(o){ var n=String(o.office||'').trim(); if(n) offSet[n]=true; });
  assets.forEach(function(a){ var n=String(a.office||'').trim(); if(n) offSet[n]=true; });
  problems.forEach(function(p){ var n=String(p.office||'').trim(); if(n) offSet[n]=true; });
  var officeList = Object.keys(offSet).sort();

  return {
    build: 'v2026-supabase-preview',
    role: ctx.role,
    issues: problems.map(mapIssue),
    worklog: worklog.map(mapLog),
    parts: parts.map(mapPart),
    offices: offices.map(mapOffice),
    assets: assets.map(mapAsset),
    life: life.map(mapLife),
    people: people.map(mapPerson),
    timelog: timelog.map(mapTime),
    purchaseorders: pos.map(mapPO),
    officeList: officeList
  };
}

// ---- row -> frontend JSON shape (mirrors functions/airtable.js's map* functions) ----

function mapIssue(r){ return {
  id:r.id, office:r.office||'', chair:r.chair_area||'', problem:r.problem||'',
  impact:(r.urgency||'').toLowerCase(), reporter:r.reported_by||'', status:r.status||'New',
  date:r.reported||'', fixed:r.date_fixed||'', history:r.history||'' }; }

function mapLife(r){ return { category:String(r.category||'').trim(), years:(r.years==null?null:Number(r.years)) }; }

function mapPerson(r){ return { id:r.id, name:String(r.name||'').trim(), active: r.active !== false }; }

function mapTime(r){ return {
  id:r.id, problemId:'', office:String(r.office||'').trim(), chair:'',
  who:String(r.who||'').trim(), start:r.start_at||'', end:r.end_at||'' }; }

function photoUrls(photos){
  if (!Array.isArray(photos)) return [];
  return photos.map(function(a){
    if (!a) return '';
    if (typeof a === 'string') return a;
    return (a.thumbnails && a.thumbnails.large && a.thumbnails.large.url) || a.url || '';
  }).filter(Boolean);
}

function mapLog(r){ var urls = photoUrls(r.photos); return {
  id:r.id, issueId:r.problem_id||'', date:r.log_date||'', who:r.who||'', note:r.note||'',
  partNumber:r.part_number||'', qty:(r.qty_used==null?'':r.qty_used), reportedOn:r.reported_on||'',
  photos: urls, photo: urls[0] || '' }; }

function mapPart(r){ var mx = r.max_qty; if (mx==null) mx = MAXBYNUM[r.part_number]; return {
  id:r.id, name:r.part_name||'', number:r.part_number||'', inStock:(r.in_warehouse==null?'':r.in_warehouse),
  reorderAt:(r.reorder_at==null?'':r.reorder_at), max:(mx==null?'':mx), bin:r.bin||'', vendor:r.vendor||'',
  lastOrdered:r.last_ordered||'', onOrder:(r.on_order_qty==null?0:r.on_order_qty), orderDate:r.order_date||'',
  cost:(r.unit_cost==null?'':r.unit_cost), netsuiteItem:r.netsuite_item||'',
  orderNow:(typeof r.in_warehouse==='number' && typeof r.reorder_at==='number' && r.in_warehouse<=r.reorder_at) }; }

function mapOffice(r){ return {
  id:r.id, office:r.office||'', ops:(r.ops==null?'':r.ops), areas:r.area_names||'', notes:r.notes||'',
  showCompleted: r.show_completed===true }; }

function mapPO(r){ return {
  id:r.id, ref:r.po_ref||'', date:r.po_date||'', vendor:r.vendor||'', clinic:r.clinic||'',
  partNumber:r.part_number||'', partName:r.part_name||'', qty:(r.quantity==null?'':r.quantity),
  rate:(r.rate==null?'':r.rate), memo:r.notes||'', description:r.description||'', receiveBy:r.receive_by||'',
  taxRate:(r.tax_rate_pct==null?'':r.tax_rate_pct), amount:(r.amount==null?'':r.amount),
  taxAmount:(r.tax_amount==null?'':r.tax_amount), lineTotal:(r.line_total==null?'':r.line_total) }; }

function mapAsset(r){ return {
  id:r.id, number:r.asset_number||'', location:r.location||'', asset:r.asset||'',
  serial:r.serial_number||'', model:r.make_model||'', date:r.manufacture_date||'', maker:r.manufacturer||'',
  office:r.office||'', status:r.status||'', lifeOverride:(r.life_override==null?'':r.life_override) }; }

// Critical equipment is always High priority, no matter what the reporter picked.
var AUTO_HIGH = /(compressor|vacuum|\bvac\b|autoclave|sterilizer|steriliz)/i;
function autoHighImpact(b){
  var text = ((b.problem || '') + ' ' + (b.chair || ''));
  if (AUTO_HIGH.test(text)) return 'high';
  return b.impact || '';
}

async function addIssue(b, ctx){
  var impact = autoHighImpact(b);
  var row = {
    org_id: ctx.orgId,
    problem: b.problem || '',
    office: b.office || '',
    chair_area: b.chair || '',
    reported_by: b.reporter || '',
    status: b.status || 'New',
    reported: today()
  };
  if (impact === 'high') row.urgency = 'High';
  else if (b.urgency) row.urgency = b.urgency;
  else if (impact) row.urgency = cap(impact);
  var created = await insertOne('problems', row, ctx.token);
  var out = { ok:true, id: created.id };
  try { var all = await sb('problems?select=id&org_id=eq.' + ctx.orgId, {}, ctx.token); out.count = all.length; } catch(e){ /* non-fatal */ }
  if (b.note){ try { await logWork(ctx, { problemId:created.id, who:b.reporter||'', note:b.note }); } catch(e){} }
  var newPics = photoList(b);
  if (newPics.length){
    try {
      await logWork(ctx, { problemId:created.id, who:b.reporter||'', note:(newPics.length>1?'Photos':'Photo')+' from reporter', photos:newPics });
      out.photo = true; out.photos = newPics.length;
    } catch (e){ out.photo = false; out.photoError = String((e && e.message) || e); }
  }
  return out;
}

async function setStatus(b, ctx){
  var fields = { status: b.status };
  if (b.status === 'Fixed') fields.date_fixed = today();
  await updateOne('problems', b.id, ctx.orgId, fields, ctx.token);
  await logWork(ctx, { problemId:b.id, who:b.who||'', note:'Status changed to ' + b.status });
  return { ok:true };
}

async function deleteRequest(b, ctx){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No request id.' };
  var logs = await sb('work_log?select=id&org_id=eq.' + ctx.orgId + '&problem_id=eq.' + id, {}, ctx.token);
  if (logs.length) await sb('work_log?org_id=eq.' + ctx.orgId + '&problem_id=eq.' + id, { method:'DELETE' }, ctx.token);
  await deleteOne('problems', id, ctx.orgId, ctx.token);
  return { ok:true, id:id, removedLogs: logs.length };
}

async function editAsset(b, ctx){
  if (!b.id) return { ok:false, error:'no record id' };
  var map = { asset:'asset', location:'location', office:'office', model:'make_model', serial:'serial_number',
              date:'manufacture_date', number:'asset_number', maker:'manufacturer', status:'status', lifeOverride:'life_override' };
  var fields = {};
  Object.keys(map).forEach(function(k){ if (b[k] !== undefined) fields[map[k]] = b[k]; });
  if (!Object.keys(fields).length) return { ok:false, error:'nothing to update' };
  await updateOne('assets', b.id, ctx.orgId, fields, ctx.token);
  return { ok:true };
}

async function setUrgency(b, ctx){
  var val = cap(b.urgency);
  await updateOne('problems', b.id, ctx.orgId, { urgency: val }, ctx.token);
  await logWork(ctx, { problemId:b.id, who:b.who||'', note:'Priority changed to ' + val });
  return { ok:true };
}

async function markNotDupe(b, ctx){
  var ids = b.ids || (b.key ? String(b.key).split(',') : []);
  var key = b.key || ids.join(',');
  var anchor = ids[0] || '';
  if (!anchor) return { ok:false, error:'no record id' };
  await logWork(ctx, { problemId: anchor, who: b.who || '', note: 'Reviewed — not a duplicate [dupe-key:' + key + ']' });
  return { ok:true };
}

async function addNote(b, ctx){
  var parts = normalizeParts(b);
  var first = parts[0];
  var primaryId = await logWork(ctx, { problemId:b.problemId||b.issueId, who:b.who, note:b.note,
                  partNumber: first ? first.number : '', qty: first ? first.qty : '', photos: photoList(b) });
  for (var i = 1; i < parts.length; i++){
    await logWork(ctx, { problemId:b.problemId||b.issueId, who:b.who, note:'(same job)',
                    partNumber: parts[i].number, qty: parts[i].qty });
  }
  var results = [];
  for (var k = 0; k < parts.length; k++){
    if (parts[k].number && parts[k].qty > 0){
      var res = await usePart(ctx, parts[k].number, parts[k].qty);
      results.push(Object.assign({ number:parts[k].number, qty:parts[k].qty }, res));
    }
  }
  var out = { ok:true, parts: results };
  var pics = photoList(b);
  if (pics.length && primaryId){ out.photos = pics.length; out.photo = true; }
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

async function logWork(ctx, b){
  var row = {
    org_id: ctx.orgId,
    entry: (b.who ? b.who + ' — ' : '') + String(b.note || '').slice(0, 40),
    problem_id: b.problemId || b.issueId || null,
    log_date: today()
  };
  if (b.who) row.who = b.who;
  if (b.note) row.note = b.note;
  if (b.partNumber) row.part_number = b.partNumber;
  if (Number(b.qty) > 0) row.qty_used = Number(b.qty);
  if (b.photos && b.photos.length){
    row.photos = b.photos.map(function(p){
      return { url: 'data:' + (p.type||'image/jpeg') + ';base64,' + p.base64, filename: p.name || 'photo.jpg' };
    });
  }
  var created = await insertOne('work_log', row, ctx.token);
  return created.id;
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

// find a Part by its part number and subtract qty from In warehouse (never below 0)
async function usePart(ctx, number, qty){
  var rec = await findPart(ctx, number);
  if (!rec) return { matched:false, message:'No part with number ' + number };
  var current = rec.in_warehouse;
  var next = Math.max((typeof current === 'number' ? current : 0) - qty, 0);
  await updateOne('parts', rec.id, ctx.orgId, { in_warehouse: next }, ctx.token);
  return { matched:true, remaining:next };
}

async function findPart(ctx, number){
  var rows = await sb('parts?select=*&org_id=eq.' + ctx.orgId + '&part_number=eq.' + encodeURIComponent(number), {}, ctx.token);
  return rows.length ? rows[0] : null;
}

// mark a part as ordered: store qty + today's date
async function orderPart(b, ctx){
  var rec = await findPart(ctx, String(b.number || '').trim());
  if (!rec) return { ok:false, matched:false };
  var qty = Number(b.qty || 0); if (qty < 0) qty = 0;
  await updateOne('parts', rec.id, ctx.orgId, { on_order_qty: qty, order_date: today() }, ctx.token);
  return { ok:true, matched:true, onOrder:qty, orderDate:today() };
}

// receive an order: add the on-order qty into stock, clear the on-order qty (keep date as last-ordered)
async function receivePart(b, ctx){
  var rec = await findPart(ctx, String(b.number || '').trim());
  if (!rec) return { ok:false, matched:false };
  var current = typeof rec.in_warehouse === 'number' ? rec.in_warehouse : 0;
  var onOrder = typeof rec.on_order_qty === 'number' ? rec.on_order_qty : 0;
  var next = current + onOrder;
  await updateOne('parts', rec.id, ctx.orgId, { in_warehouse: next, on_order_qty: 0 }, ctx.token);
  return { ok:true, matched:true, remaining:next, received:onOrder };
}

// add a received quantity onto a part's on-hand count (by record id, or by number)
async function receiveQty(b, ctx){
  var rec = null;
  if (b.id){ var rows = await sb('parts?select=*&org_id=eq.' + ctx.orgId + '&id=eq.' + b.id, {}, ctx.token); rec = rows[0]; }
  if (!rec) rec = await findPart(ctx, String(b.number || '').trim());
  if (!rec) return { ok:false, matched:false };
  var qty = Math.round(Number(b.qty)||0);
  if (qty <= 0) return { ok:false, error:'Enter how many arrived.' };
  var cur = typeof rec.in_warehouse === 'number' ? rec.in_warehouse : 0;
  var next = cur + qty;
  await updateOne('parts', rec.id, ctx.orgId, { in_warehouse: next }, ctx.token);
  return { ok:true, matched:true, id:rec.id, number:(rec.part_number||''), added:qty, remaining:next };
}

// update any of a part's fields. Prefers record id (so the part NUMBER can be changed safely); falls back to lookup by number.
async function editPart(b, ctx){
  var rec = null;
  if (b.id){ var rows = await sb('parts?select=*&org_id=eq.' + ctx.orgId + '&id=eq.' + b.id, {}, ctx.token); rec = rows[0]; }
  if (!rec) rec = await findPart(ctx, String(b.number || '').trim());
  if (!rec) return { ok:false, matched:false };
  var fields = {};
  if (b.name !== undefined && String(b.name).trim() !== '') fields.part_name = String(b.name).trim();
  if (b.number !== undefined && String(b.number).trim() !== ''){
    var newNum = String(b.number).trim();
    if (newNum !== (rec.part_number || '')){
      var clash = await findPart(ctx, newNum);
      if (clash && clash.id !== rec.id) return { ok:false, error:'Another part already uses number ' + newNum + '.' };
    }
    fields.part_number = newNum;
  }
  if (b.vendor !== undefined)       fields.vendor = String(b.vendor || '').trim();
  if (b.bin !== undefined)          fields.bin = String(b.bin || '').trim();
  if (b.netsuiteItem !== undefined) fields.netsuite_item = String(b.netsuiteItem || '').trim();
  if (b.reorderAt !== undefined && b.reorderAt !== null && b.reorderAt !== '') fields.reorder_at = Math.max(Math.round(Number(b.reorderAt)||0),0);
  if (b.max !== undefined && b.max !== null && b.max !== '') fields.max_qty = Math.max(Math.round(Number(b.max)||0),0);
  if (b.inStock !== undefined && b.inStock !== null && b.inStock !== '') fields.in_warehouse = Math.max(Math.round(Number(b.inStock)||0),0);
  if (b.cost === '') fields.unit_cost = null;
  else if (b.cost !== undefined && b.cost !== null) fields.unit_cost = Math.max(Number(b.cost)||0,0);
  if (!Object.keys(fields).length) return { ok:false, error:'Nothing to update.' };
  await updateOne('parts', rec.id, ctx.orgId, fields, ctx.token);
  return { ok:true, matched:true, id:rec.id, number:(fields.part_number || rec.part_number || '') };
}

// create a brand-new part in the warehouse
async function addPart(b, ctx){
  var number = String(b.number || '').trim();
  var name   = String(b.name || '').trim();
  if (!number || !name) return { ok:false, error:'Part number and name are required.' };
  var existing = await findPart(ctx, number);
  if (existing) return { ok:false, error:'A part with number ' + number + ' already exists.' };
  var row = { org_id: ctx.orgId, part_name:name, part_number:number,
    in_warehouse: Math.max(Math.round(Number(b.inStock) || 0), 0),
    reorder_at: Math.max(Math.round(Number(b.reorderAt) || 0), 0) };
  if (b.bin)    row.bin = String(b.bin).trim();
  if (b.vendor) row.vendor = String(b.vendor).trim();
  if (b.max !== '' && b.max != null && !isNaN(Number(b.max))) row.max_qty = Math.max(Math.round(Number(b.max)), 0);
  var created = await insertOne('parts', row, ctx.token);
  return { ok:true, id:created.id };
}

// create a new office row (so an office can exist before it has equipment)
async function addOffice(b, ctx){
  var name = String(b.office || '').trim();
  if (!name) return { ok:false, error:'Office name is required.' };
  var existing = await sb('offices?select=id&org_id=eq.' + ctx.orgId + '&office=eq.' + encodeURIComponent(name), {}, ctx.token);
  if (existing.length) return { ok:false, error:'An office named ' + name + ' already exists.' };
  var created = await insertOne('offices', { org_id: ctx.orgId, office:name }, ctx.token);
  return { ok:true, id:created.id, office:name };
}

// update an existing office's chair count / area names / notes
async function editOffice(b, ctx){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No office id.' };
  var fields = {};
  if (b.ops !== undefined) fields.ops = (b.ops === '' || b.ops === null) ? null : Math.max(Math.round(Number(b.ops) || 0), 0);
  if (b.areas !== undefined) fields.area_names = String(b.areas || '').trim();
  if (b.notes !== undefined) fields.notes = String(b.notes || '').trim();
  if (b.showCompleted !== undefined) fields.show_completed = !!b.showCompleted;
  if (!Object.keys(fields).length) return { ok:false, error:'Nothing to update.' };
  await updateOne('offices', id, ctx.orgId, fields, ctx.token);
  return { ok:true, id:id };
}

// Master on/off — flip "Show completed" for every office at once (one bulk PATCH).
async function setAllCompleted(b, ctx){
  var val = !!b.value;
  await sb('offices?org_id=eq.' + ctx.orgId, { method:'PATCH', body: JSON.stringify({ show_completed: val }) }, ctx.token);
  var offices = await sb('offices?select=id&org_id=eq.' + ctx.orgId, {}, ctx.token);
  return { ok:true, count: offices.length, value: val };
}

// clock in: start an office visit. If they never clocked out of the last office, close it at this clock-in time.
async function startWork(b, ctx){
  var when = b.when || new Date().toISOString();
  var who = String(b.who||'').trim();
  var closed = [];
  if (who){
    try {
      var open = await sb('time_log?select=*&org_id=eq.' + ctx.orgId + '&who=eq.' + encodeURIComponent(who) + '&end_at=is.null', {}, ctx.token);
      for (var i = 0; i < open.length; i++){
        try {
          await updateOne('time_log', open[i].id, ctx.orgId, { end_at: when }, ctx.token);
          closed.push({ id:open[i].id, office:String(open[i].office||'').trim(), end:when });
        } catch(e){ /* non-fatal — never block the new clock-in */ }
      }
    } catch(e){ /* carry on */ }
  }
  var created = await insertOne('time_log', { org_id:ctx.orgId, office:String(b.office||'').trim(), who:who, start_at:when }, ctx.token);
  return { ok:true, id:created.id, start:when, closed:closed };
}

// close a labor session (stamp the end time on an existing Time Log row)
async function endWork(b, ctx){
  var id = String(b.id||'').trim();
  if (!id) return { ok:false, error:'No open session id.' };
  var when = b.when || new Date().toISOString();
  await updateOne('time_log', id, ctx.orgId, { end_at: when }, ctx.token);
  return { ok:true, id:id, end:when };
}

// add a crew member
async function addPerson(b, ctx){
  var name = String(b.name || '').trim();
  if (!name) return { ok:false, error:'Name is required.' };
  var created = await insertOne('people', { org_id: ctx.orgId, name:name, active:true }, ctx.token);
  return { ok:true, id:created.id, name:name };
}

// take a crew member off the active list (keeps their name on past work)
async function deactivatePerson(b, ctx){
  var id = String(b.id || '').trim();
  if (!id) return { ok:false, error:'No person id.' };
  await updateOne('people', id, ctx.orgId, { active:false }, ctx.token);
  return { ok:true, id:id };
}

// create one or many asset rows
async function addAssets(b, ctx){
  var rows = Array.isArray(b.assets) ? b.assets : [];
  var recs = [];
  rows.forEach(function(a){
    var f = { org_id: ctx.orgId };
    if (a.office)   f.office = String(a.office).trim();
    if (a.location) f.location = String(a.location).trim();
    if (a.number)   f.asset_number = String(a.number).trim();
    if (a.asset)    f.asset = String(a.asset).trim();
    if (a.serial)   f.serial_number = String(a.serial).trim();
    if (a.model)    f.make_model = String(a.model).trim();
    if (a.date)     f.manufacture_date = String(a.date).trim();
    if (a.maker)    f.manufacturer = String(a.maker).trim();
    if (Object.keys(f).length > 1) recs.push(f);
  });
  if (!recs.length) return { ok:false, error:'No equipment to add.' };
  var created = await insertMany('assets', recs, ctx.token);
  return { ok:true, created: (created||[]).length };
}

// create a purchase order: one row per line, tied together by a PO Ref
async function createPO(b, ctx){
  var vendor = String(b.vendor || '').trim();
  var clinic = String(b.clinic || '').trim();
  var memo   = String(b.memo || '').trim();
  var date   = String(b.date || '').trim() || today();
  var lines  = Array.isArray(b.lines) ? b.lines : [];
  if (!vendor) return { ok:false, error:'Vendor is required.' };
  if (!clinic) return { ok:false, error:'Clinic is required.' };
  var clean = lines.filter(function(l){ return l && String(l.number||'').trim() && Number(l.qty) > 0; });
  if (!clean.length) return { ok:false, error:'Add at least one part with a quantity.' };
  var ref = String(b.ref || '').trim() || ('PO-' + date.replace(/-/g,'') + '-' + String(Date.now()).slice(-4));
  var taxRate = (b.taxRate !== '' && b.taxRate != null && !isNaN(Number(b.taxRate))) ? Number(b.taxRate) : null;
  var receiveBy = String(b.receiveBy || '').trim();
  var recs = clean.map(function(l){
    var f = { org_id: ctx.orgId };
    f.name = ref + ' · ' + String(l.name||l.number).trim() + ' ×' + Math.round(Number(l.qty));
    f.po_ref = ref; f.po_date = date; f.vendor = vendor; f.clinic = clinic;
    f.part_number = String(l.number).trim(); f.part_name = String(l.name||'').trim();
    f.quantity = Math.round(Number(l.qty));
    if (l.rate !== '' && l.rate != null && !isNaN(Number(l.rate))) f.rate = Number(l.rate);
    if (taxRate != null) f.tax_rate_pct = taxRate;
    if (receiveBy) f.receive_by = receiveBy;
    if (l.description) f.description = String(l.description).trim();
    if (memo) f.notes = memo;
    return f;
  });
  var created = await insertMany('purchase_orders', recs, ctx.token);
  return { ok:true, ref:ref, lines: (created||[]).length };
}

// stamp used-part entries as reported (advances the watermark), or clear them (undo) when b.clear is set
async function markReported(b, ctx){
  var ids = Array.isArray(b.ids) ? b.ids : [];
  if (!ids.length) return { ok:false, error:'No entries to mark.' };
  var date = String(b.date || '').trim() || today();
  var clear = !!b.clear;
  await sb('work_log?id=in.(' + ids.join(',') + ')&org_id=eq.' + ctx.orgId,
    { method:'PATCH', body: JSON.stringify({ reported_on: clear ? null : date }) }, ctx.token);
  return { ok:true, marked: ids.length, cleared: clear };
}

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
async function scanLabel(b, ctx){
  var img = b.image; if(!img) return { ok:false, error:'No photo received.' };
  var prompt = 'This is a phone photo of a parts package label or an invoice line, for dental/veterinary equipment maintenance. '
    + 'Read what you can. Respond with ONLY a JSON object and nothing else (no prose, no code fences). '
    + 'Keys: partNumber (the manufacturer/vendor part number or SKU printed on it, best single guess, else ""), '
    + 'partName (the item name/description, else ""), vendor (brand or supplier if shown, else ""), '
    + 'quantity (integer count of units if clearly shown, else null). If unreadable use empty strings and null.';
  var v = await _callVision(img, b.imageType, prompt);
  if(v.error) return { ok:false, error:v.error };
  var ex = _safeJSON(v.text) || {};
  var partsRows = await sb('parts?select=*&org_id=eq.' + ctx.orgId, {}, ctx.token);
  var parts = partsRows.map(mapPart);
  var matches = _matchParts(ex, parts);
  return { ok:true,
    extracted:{ partNumber:(ex.partNumber||''), partName:(ex.partName||''), vendor:(ex.vendor||''), quantity:(ex.quantity==null?'':ex.quantity) },
    matches:matches };
}
