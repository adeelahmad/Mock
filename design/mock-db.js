// Mock — data layer. DuckDB-WASM in the browser when it loads; the same API over plain arrays when it can't.
import * as SEED from './mock-data.js';
const KEY = 'mock.db.v4';
const TABLES = ['lps','stories','story_lps','questions','files','sessions','answers','settings'];
let duck = null, db = null, conn = null, mem = null, mode = 'none', saveTimer = null, storage = 'idb';
// ---- storage: IndexedDB (snapshots + recordings), localStorage as fallback for the snapshot
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('mock-store', 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function tx(store, rw, fn) { return idb().then(d => new Promise((res, rej) => { const t = d.transaction(store, rw ? 'readwrite' : 'readonly'); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); })); }
async function kvGet(k) { try { return await tx('kv', false, s => s.get(k)); } catch { storage = 'localStorage'; const v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; } }
async function kvSet(k, v) { try { await tx('kv', true, s => s.put(v, k)); } catch { storage = 'localStorage'; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } }
export const getStorage = () => storage;
export async function putBlob(k, blob) { try { await tx('blobs', true, s => s.put(blob, k)); return true; } catch { return false; } }
export async function getBlob(k) { try { return await tx('blobs', false, s => s.get(k)); } catch { return null; } }
export async function listBlobs() { try { return await tx('blobs', false, s => s.getAllKeys()); } catch { return []; } }
export async function deleteBlob(k) { try { await tx('blobs', true, s => s.delete(k)); } catch {} }
const j = (v) => JSON.stringify(v);
const esc = (v) => v == null ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : "'" + String(v).replace(/'/g, "''") + "'";

export function seedRows() {
  const lps = SEED.LPS.map((l, i) => ({ id: l.id, name: l.name, short: l.short, descr: l.desc, sort: i }));
  const stories = SEED.STORIES.map(s => ({ id: s.id, title: s.title, summary: s.summary, numbers: j(s.numbers), situation: s.situation || '', task: s.task || '', action: s.action || '', result: s.result || '', learning: s.learning || '', uses: s.uses, best: s.best, last_used: s.lastUsed }));
  const story_lps = SEED.STORIES.flatMap(s => [...s.primary.map(id => ({ story_id: s.id, lp_id: id, role: 'primary' })), ...s.secondary.map(id => ({ story_id: s.id, lp_id: id, role: 'secondary' }))]);
  const questions = SEED.QUESTIONS.map(q => ({ id: q.id, text: q.text, lp_id: q.lp, source: q.source, difficulty: q.difficulty, asked: q.asked, last_verdict: q.last, best: q.best, tags: '', sample: '' }));
  const files = SEED.FILES.map(f => ({ name: f.name, type: f.type, size: f.size, updated: f.updated, included: f.on, content: '' }));
  const sessions = SEED.SESSIONS.map(s => ({ n: s.n, date: s.date, mode: s.mode, duration: s.duration, focus: s.focus || '', seed: 1000 + s.n * 37 }));
  const answers = []; let k = 0;
  const qFor = (lp) => (SEED.QUESTIONS.find(q => q.lp === lp) || {}).text || '';
  const storyFor = (lp) => (SEED.STORIES.find(s => s.primary.includes(lp)) || SEED.STORIES.find(s => s.secondary.includes(lp)) || {}).title || '';
  for (const [lp, arr] of Object.entries(SEED.HEAT)) arr.forEach((v, i) => { if (v) answers.push({ id: 'a' + (++k), session_n: SEED.SESSION_COLS[i], q_index: Object.keys(SEED.HEAT).indexOf(lp), lp_id: lp, question: qFor(lp), story: storyFor(lp), verdict: v, strength: '', fixes: '[]', better: '', reason: '', missed: '[]', star_s: 25, star_t: 20, star_a: 35, star_r: 20, i_pct: 50, pace: 150, fillers: 5, length: '2:40' }); });
  SEED.ANALYSES.forEach((a, i) => { const lp = SEED.LPS.find(l => l.name === a.lp); const row = { id: 'a' + (++k), session_n: 14, q_index: i, lp_id: lp ? lp.id : 'deep', question: a.question, story: a.story, verdict: a.verdict, strength: a.strength, fixes: j(a.fixes), better: a.better || '', reason: a.reason || '', missed: j(a.missed), star_s: a.star.s, star_t: a.star.t, star_a: a.star.a, star_r: a.star.r, i_pct: a.iPct, pace: a.pace, fillers: a.fillers, length: a.length }; const idx = answers.findIndex(x => x.session_n === 14 && x.lp_id === row.lp_id); if (idx >= 0) answers[idx] = row; else answers.push(row); });
  const settings = [{ key: 'interview_date', value: '2026-10-30' }, { key: 'pause_ms', value: '2500' }, { key: 'coaching', value: 'each' }, { key: 'seed', value: String(Math.floor(Math.random() * 90000) + 10000) }, { key: 'text_model', value: 'gemini-2.5-flash' }, { key: 'system', value: 'You are interviewing me for a Senior SDM role at AWS. Ask one Leadership Principle question at a time, then probe with at most two follow-ups that push for specifics: numbers, my personal actions, what I would do differently. As coach, judge me only against my own stories and files. Name the better story if there is one. Quote the number I missed. One strength, up to three fixes, a verdict on the four-step scale. Be direct; no praise padding.' }];
  return { lps, stories, story_lps, questions, files, sessions, answers, settings };
}

async function defaultBank() {
  try { const r = await fetch('./exponent-bank.json'); if (!r.ok) return []; const rows = await r.json(); return rows.map(x => ({ id: x.id, text: x.text, lp_id: x.lp_id || '', source: 'exponent', difficulty: x.difficulty || 2, asked: 0, last_verdict: 0, best: 0, tags: x.tags || '', sample: x.sample || '' })); } catch { return []; }
}
export async function init(onStatus) {
  const snap = await kvGet(KEY);
  const data = snap || seedRows();
  if (!snap) { onStatus && onStatus('Loading the default question bank…'); const bank = await defaultBank(); const have = new Set(data.questions.map(q => q.text.toLowerCase())); for (const b of bank) if (!have.has(b.text.toLowerCase())) data.questions.push(b); }
  try {
    onStatus && onStatus('Loading DuckDB-WASM…');
    duck = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
    const bundle = await duck.selectBundle(duck.getJsDelivrBundles());
    const worker = new Worker(URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })));
    db = new duck.AsyncDuckDB(new duck.ConsoleLogger(duck.LogLevel.WARNING), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    conn = await db.connect();
    for (const t of TABLES) { const rows = data[t] && data[t].length ? data[t] : seedRows()[t]; await db.registerFileText(t + '.json', JSON.stringify(rows)); await conn.insertJSONFromPath(t + '.json', { name: t }); if (!(data[t] && data[t].length)) await conn.query(`DELETE FROM ${t}`); }
    mode = 'duckdb';
  } catch (e) { console.warn('[mock-db] DuckDB-WASM unavailable, using in-memory tables', e); mem = data; mode = 'memory'; }
  if (!snap) save();
  return mode;
}
export const getMode = () => mode;

async function q(sql) {
  const r = await conn.query(sql);
  return r.toArray().map(row => { const o = row.toJSON(); for (const k in o) if (typeof o[k] === 'bigint') o[k] = Number(o[k]); return o; });
}
async function all(t) { return mode === 'duckdb' ? q(`SELECT * FROM ${t}`) : mem[t].map(r => ({ ...r })); }
async function run(sql, memFn) { if (mode === 'duckdb') await conn.query(sql); else memFn(mem); save(); }
export function save() { clearTimeout(saveTimer); saveTimer = setTimeout(async () => { const out = {}; for (const t of TABLES) out[t] = await all(t); await kvSet(KEY, out); }, 150); }
export async function exportJSON() { const out = { app: 'mock', version: 3, exported: new Date().toISOString(), tables: {} }; for (const t of TABLES) out.tables[t] = await all(t); return JSON.stringify(out, null, 1); }
export async function importBackup(json) {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json; const data = parsed.tables || parsed;
  for (const t of TABLES) if (!Array.isArray(data[t])) throw new Error('Not a Mock backup: missing table ' + t);
  if (mode === 'duckdb') { for (const t of TABLES) { await conn.query(`DELETE FROM ${t}`); if (data[t].length) { await db.registerFileText(t + '.restore.json', JSON.stringify(data[t])); await conn.insertJSONFromPath(t + '.restore.json', { name: t, create: false }); } } }
  else mem = data;
  save();
}
export async function reset() { try { await tx('kv', true, s => s.delete(KEY)); } catch {} localStorage.removeItem(KEY); localStorage.removeItem('mock.onboarded'); }

// ---- reads
export async function lps() {
  if (mode === 'duckdb') return q(`SELECT l.id, l.name, l.short, l.descr, l.sort,
    (SELECT count(*) FROM story_lps s WHERE s.lp_id = l.id) AS stories,
    (SELECT count(*) FROM questions x WHERE x.lp_id = l.id) AS questions,
    coalesce((SELECT a.verdict FROM answers a WHERE a.lp_id = l.id ORDER BY a.session_n DESC, a.q_index DESC LIMIT 1), 0) AS verdict,
    (SELECT max(a.session_n) FROM answers a WHERE a.lp_id = l.id) AS last_session
    FROM lps l ORDER BY l.sort`);
  return mem.lps.slice().sort((a, b) => a.sort - b.sort).map(l => { const as = mem.answers.filter(a => a.lp_id === l.id).sort((a, b) => b.session_n - a.session_n || b.q_index - a.q_index); return { ...l, stories: mem.story_lps.filter(s => s.lp_id === l.id).length, questions: mem.questions.filter(x => x.lp_id === l.id).length, verdict: as.length ? as[0].verdict : 0, last_session: as.length ? Math.max(...as.map(a => a.session_n)) : null }; });
}
export async function stories() {
  const rows = mode === 'duckdb' ? await q(`SELECT s.*, (SELECT string_agg(x.lp_id || ':' || x.role, ',') FROM story_lps x WHERE x.story_id = s.id) AS maps FROM stories s ORDER BY s.uses DESC, s.title`) : mem.stories.slice().sort((a, b) => b.uses - a.uses).map(s => ({ ...s, maps: mem.story_lps.filter(x => x.story_id === s.id).map(x => x.lp_id + ':' + x.role).join(',') }));
  return rows.map(s => ({ ...s, numbers: JSON.parse(s.numbers || '[]'), primary: (s.maps || '').split(',').filter(Boolean).filter(m => m.endsWith(':primary')).map(m => m.split(':')[0]), secondary: (s.maps || '').split(',').filter(Boolean).filter(m => m.endsWith(':secondary')).map(m => m.split(':')[0]) }));
}
export async function questions() { return mode === 'duckdb' ? q(`SELECT * FROM questions ORDER BY asked DESC, id`) : mem.questions.slice().sort((a, b) => b.asked - a.asked); }
export async function files() { return mode === 'duckdb' ? q(`SELECT * FROM files ORDER BY name`) : mem.files.slice(); }
export async function sessions() {
  if (mode === 'duckdb') return q(`SELECT s.*, (SELECT string_agg(a.verdict::VARCHAR, ',' ORDER BY a.q_index) FROM answers a WHERE a.session_n = s.n) AS verdicts FROM sessions s ORDER BY s.n DESC`);
  return mem.sessions.slice().sort((a, b) => b.n - a.n).map(s => ({ ...s, verdicts: mem.answers.filter(a => a.session_n === s.n).sort((a, b) => a.q_index - b.q_index).map(a => a.verdict).join(',') }));
}
export async function answers(n) {
  const rows = mode === 'duckdb' ? await q(`SELECT a.*, l.name AS lp_name FROM answers a LEFT JOIN lps l ON l.id = a.lp_id WHERE a.session_n = ${+n} ORDER BY a.q_index`) : mem.answers.filter(a => a.session_n === n).sort((a, b) => a.q_index - b.q_index).map(a => ({ ...a, lp_name: (mem.lps.find(l => l.id === a.lp_id) || {}).name }));
  return rows.map(a => ({ ...a, fixes: JSON.parse(a.fixes || '[]'), missed: JSON.parse(a.missed || '[]') }));
}
export async function heat() { return mode === 'duckdb' ? q(`SELECT lp_id, session_n, max(verdict) AS verdict FROM answers GROUP BY 1, 2 ORDER BY 2`) : Object.values(mem.answers.reduce((o, a) => { const k = a.lp_id + '|' + a.session_n; o[k] = o[k] || { lp_id: a.lp_id, session_n: a.session_n, verdict: 0 }; o[k].verdict = Math.max(o[k].verdict, a.verdict); return o; }, {})).sort((a, b) => a.session_n - b.session_n); }
export async function settings() { const rows = await all('settings'); return Object.fromEntries(rows.map(r => [r.key, r.value])); }

// ---- writes
export async function setSetting(key, value) { await run(`DELETE FROM settings WHERE key = ${esc(key)}; INSERT INTO settings VALUES (${esc(key)}, ${esc(String(value))})`, m => { m.settings = m.settings.filter(r => r.key !== key); m.settings.push({ key, value: String(value) }); }); }
export async function setFileIncluded(name, on) { await run(`UPDATE files SET included = ${on ? 'TRUE' : 'FALSE'} WHERE name = ${esc(name)}`, m => { const f = m.files.find(f => f.name === name); if (f) f.included = on; }); }
export async function addFile(f) { await run(`DELETE FROM files WHERE name = ${esc(f.name)}; INSERT INTO files VALUES (${esc(f.name)}, ${esc(f.type)}, ${esc(f.size)}, ${esc(f.updated)}, TRUE, ${esc(f.content)})`, m => { m.files = m.files.filter(x => x.name !== f.name); m.files.push({ ...f, included: true }); }); }
export async function addQuestions(list) { for (const x of list) await run(`INSERT INTO questions VALUES (${esc(x.id)}, ${esc(x.text)}, ${esc(x.lp_id)}, ${esc(x.source)}, ${x.difficulty || 2}, 0, 0, 0, ${esc(x.tags || '')}, ${esc(x.sample || '')})`, m => m.questions.push({ ...x, asked: 0, last_verdict: 0, best: 0, tags: x.tags || '', sample: x.sample || '' })); }
export async function setQuestionLp(id, lpId) { await run(`UPDATE questions SET lp_id = ${esc(lpId)} WHERE id = ${esc(id)}`, m => { const q = m.questions.find(x => x.id === id); if (q) q.lp_id = lpId; }); }
export async function setStoryLp(storyId, lpId, role) { await run(`DELETE FROM story_lps WHERE story_id = ${esc(storyId)} AND lp_id = ${esc(lpId)};` + (role ? ` INSERT INTO story_lps VALUES (${esc(storyId)}, ${esc(lpId)}, ${esc(role)})` : ''), m => { m.story_lps = m.story_lps.filter(x => !(x.story_id === storyId && x.lp_id === lpId)); if (role) m.story_lps.push({ story_id: storyId, lp_id: lpId, role }); }); }
export async function insertSession(s) { await run(`INSERT INTO sessions VALUES (${s.n}, ${esc(s.date)}, ${esc(s.mode)}, ${esc(s.duration)}, ${esc(s.focus || '')}, ${+(s.seed || 0)})`, m => m.sessions.push({ ...s, seed: +(s.seed || 0) })); }
export async function insertAnswer(a) {
  const row = { id: a.id, session_n: a.session_n, q_index: a.q_index, lp_id: a.lp_id, question: a.question, story: a.story || '', verdict: a.verdict, strength: a.strength || '', fixes: j(a.fixes || []), better: a.better || '', reason: a.reason || '', missed: j(a.missed || []), star_s: a.star_s || 25, star_t: a.star_t || 20, star_a: a.star_a || 35, star_r: a.star_r || 20, i_pct: a.i_pct || 50, pace: a.pace || 150, fillers: a.fillers || 0, length: a.length || '0:00' };
  await run(`INSERT INTO answers VALUES (${['id','session_n','q_index','lp_id','question','story','verdict','strength','fixes','better','reason','missed','star_s','star_t','star_a','star_r','i_pct','pace','fillers','length'].map(k => esc(row[k])).join(', ')})`, m => m.answers.push(row));
  await run(`UPDATE questions SET asked = asked + 1, last_verdict = ${row.verdict} WHERE text = ${esc(row.question)}`, m => { const qq = m.questions.find(x => x.text === row.question); if (qq) { qq.asked++; qq.last_verdict = row.verdict; } });
}
export async function nextSessionNo() { const rows = await all('sessions'); return rows.reduce((m, s) => Math.max(m, s.n), 0) + 1; }
