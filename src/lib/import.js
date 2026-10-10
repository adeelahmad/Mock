// Mock — Exponent export importer. Streams a .zst (or plain .json) export, keeps behavioural questions, tags LPs by keyword.
const KW = [['disagree','back'],['pushed back','back'],['push back','back'],['conflict','back'],['convince','back'],['persua','back'],['customer','co'],['client','co'],['user','co'],['ownership','own'],['went above','own'],['outside your','own'],['beyond your','own'],['simplif','inv'],['innovat','inv'],['invent','inv'],['creative','inv'],['wrong','right'],['mistake','right'],['judgment','right'],['judgement','right'],['bad decision','right'],['curious','learn'],['new skill','learn'],['learn','learn'],['hire','hire'],['mentor','hire'],['coach','hire'],['develop','hire'],['underperform','hire'],['quality','std'],['standard','std'],['refused','std'],['ambitious','big'],['vision','big'],['big','big'],['long-term','big'],['without all','bias'],['incomplete','bias'],['quick decision','bias'],['fast','bias'],['risk','bias'],['limited resource','frugal'],['budget','frugal'],['frugal','frugal'],['cost','frugal'],['trust','trust'],['bad news','trust'],['feedback','trust'],['difficult conversation','trust'],['dive','deep'],['root cause','deep'],['detail','deep'],['debug','deep'],['data','deep'],['deadline','deliver'],['deliver','deliver'],['missed','deliver'],['fail','deliver'],['prioriti','deliver'],['tight','deliver'],['burnout','employer'],['team morale','employer'],['inclusi','employer'],['well-being','employer'],['wellbeing','employer'],['ethic','scale'],['responsib','scale'],['impact on','scale'],['community','scale']];
export const guessLp = (title) => { const low = title.toLowerCase(); const hit = KW.find(([k]) => low.includes(k)); return hit ? hit[1] : ''; };
const sleep = () => new Promise(r => setTimeout(r, 0));

export async function importExponent(src, onProgress) {
  const rows = [], seen = new Set(); let objects = 0, carry = '', started = false;
  const consume = (txt) => { let j; try { j = JSON.parse(txt); } catch { return; } objects++;
    const cat = j.category || [], title = j.data && j.data.title; if (!title) return;
    const behavioral = cat.includes('behavioral') || cat.includes('leadership') || cat.includes('people-management') || /tell me about a time|describe a (time|situation)|give me an example|when have you|how do you handle|how would you handle/i.test(title);
    if (!behavioral) return; const key = title.trim().toLowerCase(); if (seen.has(key)) return; seen.add(key);
    const companies = (j.companies || []).map(c => c.name);
    rows.push({ id: 'x' + j.id, text: title.trim(), lp_id: guessLp(title), source: 'exponent', difficulty: j.difficulty === 'hard' ? 3 : j.difficulty === 'easy' ? 1 : 2, tags: companies.slice(0, 4).join(', '), votes: j.votes || 0, amazon: companies.some(c => /amazon|aws/i.test(c)), sample: (j.topComment && j.topComment.comment ? j.topComment.comment.replace(/\s+/g, ' ').trim().slice(0, 700) : '') });
  };
  const scan = () => {
    if (!started) { const i = carry.indexOf('"results":['); if (i < 0) { if (carry.length > 200000) carry = carry.slice(-100000); return; } carry = carry.slice(i + 11); started = true; }
    let depth = 0, inStr = false, esc = false, s0 = -1, last = 0;
    for (let i = 0; i < carry.length; i++) { const ch = carry[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{') { if (depth === 0) s0 = i; depth++; } else if (ch === '}') { depth--; if (depth === 0 && s0 >= 0) { consume(carry.slice(s0, i + 1)); last = i + 1; s0 = -1; } } }
    carry = carry.slice(last);
  };
  const dec = new TextDecoder();
  const feedText = (t) => { carry += t.replace(/"embedding":"\[[^"]*"/g, '"embedding":""'); if (carry.length > 1000000) scan(); };
  const buf = new Uint8Array(await (src instanceof Blob ? src : await (await fetch(src)).blob()).arrayBuffer());
  const isZst = buf[0] === 0x28 && buf[1] === 0xB5 && buf[2] === 0x2F && buf[3] === 0xFD;
  if (isZst) {
    const fz = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/+esm');
    let out = 0; const d = new fz.Decompress((chunk) => { out += chunk.length; feedText(dec.decode(chunk, { stream: true })); });
    const step = 1 << 18;
    try { for (let i = 0; i < buf.length; i += step) { d.push(buf.subarray(i, Math.min(buf.length, i + step)), i + step >= buf.length); onProgress && onProgress({ pct: Math.round(i / buf.length * 100), objects, rows: rows.length, bytes: out }); await sleep(); } }
    catch (e) { onProgress && onProgress({ pct: 100, objects, rows: rows.length, note: 'file ended early — kept what was readable' }); }
  } else {
    const text = dec.decode(buf); for (let i = 0; i < text.length; i += 2000000) { feedText(text.slice(i, i + 2000000)); onProgress && onProgress({ pct: Math.round(i / text.length * 100), objects, rows: rows.length }); await sleep(); }
  }
  scan();
  rows.sort((a, b) => (b.amazon - a.amazon) || (b.votes - a.votes));
  return { rows, objects };
}
