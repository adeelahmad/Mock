// Mock — shared sample content. Realistic, invented. No Amazon text is quoted.
export const VERDICTS = {
  0:{label:'Not yet',glyph:'○',bg:'transparent',fg:'var(--m-fg3)',line:'var(--m-line2)',dash:true,fill:'var(--m-elev)',onFill:'var(--m-fg3)'},
  1:{label:'Strong hire',glyph:'✓',bg:'var(--m-green-tint)',fg:'var(--m-green)',line:'var(--m-green-line)',fill:'var(--m-green-fill)',onFill:'#FFFFFF'},
  2:{label:'Inclined',glyph:'◆',bg:'var(--m-blue-tint)',fg:'var(--m-blue)',line:'var(--m-blue-line)',fill:'var(--m-blue-fill)',onFill:'#FFFFFF'},
  3:{label:'Not inclined',glyph:'●',bg:'var(--m-gold-tint)',fg:'var(--m-gold)',line:'var(--m-gold-line)',fill:'var(--m-gold-fill)',onFill:'#202124'},
  4:{label:'Strong no hire',glyph:'✕',bg:'var(--m-red-tint)',fg:'var(--m-red)',line:'var(--m-red-line)',fill:'var(--m-red-fill)',onFill:'#FFFFFF'},
};
export const v = (code) => {
  const d = VERDICTS[code] || VERDICTS[0];
  return {vCode:code, vLabel:d.label, vGlyph:d.glyph, vBg:d.bg, vFg:d.fg, vLine:d.line, vFill:d.fill, vOnFill:d.onFill, vBorder:(d.dash?'1px dashed ':'1px solid ')+d.line};
};

export const LPS = [
  {id:'co', name:'Customer Obsession', short:'CO', stories:2, questions:9, verdict:2, last:'2 days ago', days:2, desc:'Start from the customer and work backwards. Earn and keep their trust; watch competitors, but obsess over customers.'},
  {id:'own', name:'Ownership', short:'OW', stories:2, questions:7, verdict:1, last:'Yesterday', days:1, desc:'Think long term and act for the whole company, not just your team. Never say “that’s not my job”.'},
  {id:'inv', name:'Invent and Simplify', short:'IS', stories:1, questions:6, verdict:2, last:'4 days ago', days:4, desc:'Expect invention from your team and look for ways to simplify. Accept being misunderstood for a while.'},
  {id:'right', name:'Are Right A Lot', short:'RL', stories:0, questions:5, verdict:3, last:'9 days ago', days:9, desc:'Good judgement and strong instincts, with the humility to seek out different views and change your mind.'},
  {id:'learn', name:'Learn and Be Curious', short:'LC', stories:0, questions:4, verdict:0, last:'Never', days:99, desc:'Never stop learning; stay curious about new possibilities and act on them.'},
  {id:'hire', name:'Hire and Develop the Best', short:'HD', stories:2, questions:6, verdict:2, last:'3 days ago', days:3, desc:'Raise the bar with every hire and promotion. Recognise exceptional talent and coach people seriously.'},
  {id:'std', name:'Insist on the Highest Standards', short:'HS', stories:2, questions:8, verdict:1, last:'Yesterday', days:1, desc:'Relentlessly high standards that others may find unreasonable. Defects don’t get sent down the line.'},
  {id:'big', name:'Think Big', short:'TB', stories:0, questions:5, verdict:3, last:'12 days ago', days:12, desc:'Thinking small is a self-fulfilling prophecy. Set a bold direction that inspires results.'},
  {id:'bias', name:'Bias for Action', short:'BA', stories:2, questions:8, verdict:2, last:'2 days ago', days:2, desc:'Speed matters. Many decisions are reversible and don’t need extensive study; take calculated risks.'},
  {id:'frugal', name:'Frugality', short:'FR', stories:2, questions:4, verdict:2, last:'5 days ago', days:5, desc:'Accomplish more with less. Constraints breed resourcefulness and invention.'},
  {id:'trust', name:'Earn Trust', short:'ET', stories:2, questions:7, verdict:2, last:'6 days ago', days:6, desc:'Listen attentively, speak candidly, treat others respectfully. Be vocally self-critical.'},
  {id:'deep', name:'Dive Deep', short:'DD', stories:3, questions:9, verdict:3, last:'Yesterday', days:1, desc:'Operate at all levels, stay connected to the details, audit often and be sceptical when metrics and anecdotes differ.'},
  {id:'back', name:'Have Backbone; Disagree and Commit', short:'HB', stories:1, questions:7, verdict:1, last:'3 days ago', days:3, desc:'Challenge decisions you disagree with, respectfully and tenaciously. Once decided, commit wholly.'},
  {id:'deliver', name:'Deliver Results', short:'DR', stories:2, questions:8, verdict:2, last:'2 days ago', days:2, desc:'Focus on the key inputs and deliver with the right quality and on time. Never settle, despite setbacks.'},
  {id:'employer', name:'Strive to be Earth’s Best Employer', short:'BE', stories:1, questions:3, verdict:2, last:'7 days ago', days:7, desc:'Create a safer, more productive, more diverse and just work environment. Lead with empathy.'},
  {id:'scale', name:'Success and Scale Bring Broad Responsibility', short:'SS', stories:1, questions:3, verdict:3, last:'8 days ago', days:8, desc:'Be humble and thoughtful about the secondary effects of your actions; leave things better than you found them.'},
].map(l => ({...l, ...v(l.verdict)}));
export const lpById = Object.fromEntries(LPS.map(l => [l.id, l]));

export const STORIES = [
  {id:'payments', title:'Payments outage', summary:'Led a Sev-1 recovery on the card-payments path during Black Friday week.', numbers:['41 min to mitigate','$1.2M exposure avoided','0 repeats in 6 months'], primary:['deep'], secondary:['own','bias','trust'], best:2, uses:9, lastUsed:'Yesterday',
    situation:'Black Friday week, 07:40. Card authorisations started failing for ~18% of EU traffic. The on-call engineer suspected the payment provider; dashboards disagreed.', task:'As the owning SDM I had to restore authorisations before the 09:00 traffic peak and keep leadership informed without pulling engineers off the fix.', action:'I split the room: two engineers bisected the last three deploys while I traced the failing auth path myself and found a retry storm from a config change. Rolled it back, added a kill switch.', result:'Mitigated in 41 minutes, roughly $1.2M of exposure avoided. Shipped a retry budget and a canary for config; zero repeats in six months.', learning:'Audit the boring config path first. Say the number before the narrative.'},
  {id:'migration', title:'Legacy data migration', summary:'Moved 220 tables and 14 TB off a dying Oracle cluster with zero customer downtime.', numbers:['14 TB · 220 tables','Nightly batch 6h → 40 min','0 min downtime'], primary:['std'], secondary:['deliver','deep'], best:1, uses:5, lastUsed:'3 days ago'},
  {id:'rebuild', title:'Platform rebuild', summary:'Rebuilt merchant onboarding as a self-serve platform with a team of 8.', numbers:['Onboarding 3 weeks → 2 days','8 engineers','+31% activation'], primary:['inv'], secondary:['deliver','hire'], best:2, uses:6, lastUsed:'2 days ago'},
  {id:'vendor', title:'Vendor contract pushback', summary:'Argued against renewing a $400k analytics contract my manager had championed.', numbers:['$400k / yr','3-week bake-off','$290k saved'], primary:['back'], secondary:['frugal'], best:1, uses:4, lastUsed:'3 days ago'},
  {id:'hiring', title:'Hiring bar reset', summary:'Rewrote the loop after two mis-hires; lifted offer-accept and first-year retention.', numbers:['Offer-accept 45% → 70%','12 hires in 2 quarters','2 mis-hires → 0'], primary:['hire'], secondary:['std'], best:2, uses:3, lastUsed:'5 days ago'},
  {id:'nordics', title:'Nordics escalation', summary:'Turned a churn-risk enterprise account by sitting in their ops room for a week.', numbers:['€2.1M ARR retained','NPS −20 → +41','6 weeks'], primary:['co'], secondary:['trust'], best:2, uses:4, lastUsed:'2 days ago'},
  {id:'logging', title:'Observability cost cut', summary:'Cut logging and metrics spend without losing a single alert.', numbers:['−38% spend','$610k / yr','0 alerts lost'], primary:['frugal'], secondary:['deep'], best:2, uses:2, lastUsed:'6 days ago'},
  {id:'oncall', title:'On-call redesign', summary:'Redesigned a burning-out rotation; pages per week halved.', numbers:['Pages 38 → 16 / wk','Attrition 3 → 0','Follow-the-sun, 2 sites'], primary:['employer'], secondary:['own'], best:2, uses:2, lastUsed:'7 days ago'},
  {id:'mvp', title:'Launch under ambiguity', summary:'Shipped the fraud-rules MVP on a 30% data sample rather than wait a quarter.', numbers:['30% sample','Shipped in 5 weeks','False positives −22%'], primary:['bias'], secondary:[], best:2, uses:3, lastUsed:'2 days ago'},
  {id:'a11y', title:'Accessibility audit', summary:'Drove a WCAG AA remediation across 4 product surfaces.', numbers:['4 surfaces','212 issues → 9','AA in 2 quarters'], primary:['scale'], secondary:['co'], best:3, uses:1, lastUsed:'8 days ago'},
].map(s => ({...s, ...v(s.best), overused:s.uses>=8, lpShorts:[...s.primary,...s.secondary].map(id => lpById[id].short), primaryNames:s.primary.map(id=>lpById[id].name), secondaryNames:s.secondary.map(id=>lpById[id].name)}));
export const storyById = Object.fromEntries(STORIES.map(s => [s.id, s]));

export const INTERVIEWERS = [
  {n:1, name:'Priya Raman', role:'Hiring manager', mono:'PR'},
  {n:2, name:'Tomasz Nowak', role:'Peer SDM', mono:'TN'},
  {n:3, name:'Dana Whitfield', role:'Bar Raiser', mono:'DW'},
  {n:4, name:'Marcus Oyelaran', role:'Skip-level', mono:'MO'},
  {n:5, name:'Elena Castellanos', role:'Partner team', mono:'EC'},
];

export const QUESTIONS = [
  {id:'q1', text:'Tell me about a time you made a decision without all the data you wanted.', lp:'bias', source:'previous', difficulty:2, asked:4, last:2, best:2},
  {id:'q2', text:'Tell me about a time you disagreed with your manager.', lp:'back', source:'previous', difficulty:3, asked:3, last:1, best:1},
  {id:'q3', text:'Tell me about a time you found a problem that others had missed. How did you find it?', lp:'deep', source:'common', difficulty:3, asked:5, last:3, best:2},
  {id:'q4', text:'Describe something you took on because it needed doing, not because it was your job.', lp:'own', source:'common', difficulty:2, asked:2, last:1, best:1},
  {id:'q5', text:'Tell me about a time you had to deliver bad news to a stakeholder.', lp:'trust', source:'previous', difficulty:2, asked:1, last:2, best:2},
  {id:'q6', text:'Tell me about a time you went against the team’s preference to do right by the customer.', lp:'co', source:'common', difficulty:2, asked:3, last:2, best:2},
  {id:'q7', text:'Tell me about a time you missed a deadline. What happened?', lp:'deliver', source:'common', difficulty:2, asked:2, last:3, best:2},
  {id:'q8', text:'Give me an example of a complex process you simplified.', lp:'inv', source:'custom', difficulty:1, asked:1, last:2, best:2},
  {id:'q9', text:'Tell me about a time you proposed something people thought was too ambitious.', lp:'big', source:'common', difficulty:3, asked:1, last:3, best:3},
  {id:'q10', text:'Tell me about a time you delivered a result with far fewer resources than planned.', lp:'frugal', source:'previous', difficulty:2, asked:2, last:2, best:2},
  {id:'q11', text:'Tell me about a time you refused to ship something.', lp:'std', source:'common', difficulty:2, asked:3, last:1, best:1},
  {id:'q12', text:'Tell me about someone you grew into a bigger role.', lp:'hire', source:'custom', difficulty:1, asked:0, last:0, best:0},
  {id:'q13', text:'Tell me about a time you learned something outside your area to solve a problem.', lp:'learn', source:'common', difficulty:1, asked:0, last:0, best:0},
  {id:'q14', text:'Tell me about a decision you got wrong. How did you find out?', lp:'right', source:'previous', difficulty:3, asked:2, last:3, best:2},
].map(q => ({...q, ...v(q.last), lpName:lpById[q.lp].name, lpShort:lpById[q.lp].short, sourceLabel:{previous:'Previous interview',common:'Common',custom:'Custom'}[q.source], diffLabel:['','Easy','Medium','Hard'][q.difficulty], bestLabel:VERDICTS[q.best].label, bestGlyph:VERDICTS[q.best].glyph, bestFg:VERDICTS[q.best].fg, askedLabel:q.asked?`Asked ${q.asked}×`:'Not asked'}));

export const SESSIONS = [
  {n:14, date:'Sat 10 Oct', mode:'Full loop', duration:'48 min', verdicts:[2,1,3,2,2], focus:'Dive Deep — quantify the blast radius before the fix'},
  {n:13, date:'Thu 8 Oct', mode:'One LP · Dive Deep', duration:'22 min', verdicts:[3,3,2]},
  {n:12, date:'Wed 7 Oct', mode:'Pressure-test · Payments outage', duration:'19 min', verdicts:[2,2,1]},
  {n:11, date:'Mon 5 Oct', mode:'Bar raiser', duration:'31 min', verdicts:[3,2,2,4]},
  {n:10, date:'Sat 3 Oct', mode:'Full loop', duration:'52 min', verdicts:[2,2,3,2,3]},
  {n:9, date:'Thu 1 Oct', mode:'Question set · Previous interviews', duration:'27 min', verdicts:[3,2,2]},
  {n:8, date:'Tue 29 Sep', mode:'One LP · Have Backbone', duration:'18 min', verdicts:[2,1]},
  {n:7, date:'Sun 27 Sep', mode:'Full loop', duration:'55 min', verdicts:[3,3,2,4,2]},
].map(s => ({...s, chips:s.verdicts.map(c => v(c))}));

// Heatmap: 16 LPs × 8 sessions (oldest → newest), 0 = not asked
export const HEAT = {
  co:[2,0,2,0,2,0,0,2], own:[0,1,0,2,0,1,0,1], inv:[3,0,2,0,0,0,2,2], right:[0,0,3,0,3,0,0,0], learn:[0,0,0,0,0,0,0,0], hire:[0,0,0,2,0,0,2,2], std:[2,0,2,0,1,0,1,1], big:[4,0,0,3,0,0,0,0],
  bias:[0,2,0,2,0,2,2,2], frugal:[0,0,3,0,2,0,0,0], trust:[3,0,0,2,0,0,2,0], deep:[3,0,3,3,0,3,3,3], back:[2,1,0,0,2,0,1,1], deliver:[0,2,2,0,2,2,0,2], employer:[0,0,0,0,2,0,0,0], scale:[0,0,0,0,0,3,0,0],
};
export const HEAT_ROWS = LPS.map(l => ({name:l.name, short:l.short, cells:HEAT[l.id].map(c => v(c))}));
export const SESSION_COLS = [7,8,9,10,11,12,13,14];

export const ANALYSES = [
  {q:'Q3', question:'Tell me about a time you found a problem that others had missed. How did you find it?', lp:'Dive Deep', story:'Payments outage', verdict:3,
   better:'Legacy data migration', reason:'It shows you tracing the root cause yourself, not delegating the trace.',
   missed:[{notes:'41 min to mitigate',said:'“under an hour”'},{notes:'$1.2M exposure avoided',said:'“significant”'},{notes:'0 repeats in 6 months',said:'not mentioned'}],
   star:{s:35,t:10,a:40,r:15}, iPct:38, pace:168, paceNote:'fast', fillers:11, length:'4:12', lengthNote:'long',
   strength:'You named the exact failing component and the metric you watched while fixing it.',
   fixes:['Open with the numbers: 41 minutes, $1.2M.','Cut the setup to two sentences — the room knows what Black Friday is.','Say what you personally did in the first ten minutes.']},
  {q:'Q1', question:'Tell me about a time you made a decision without all the data you wanted.', lp:'Bias for Action', story:'Launch under ambiguity', verdict:2,
   better:null, reason:'Right story. Keep it.',
   missed:[{notes:'False positives −22%',said:'“fewer false positives”'}],
   star:{s:20,t:15,a:45,r:20}, iPct:61, pace:142, paceNote:'good', fillers:4, length:'2:48', lengthNote:'good',
   strength:'Clear framing of what was reversible and what wasn’t.',
   fixes:['Quantify the result: −22% false positives.','Name the risk you accepted and the trip-wire you set.']},
  {q:'Q2', question:'Tell me about a time you disagreed with your manager.', lp:'Have Backbone; Disagree and Commit', story:'Vendor contract pushback', verdict:1,
   better:null, reason:'Right story. Keep it.', missed:[],
   star:{s:15,t:15,a:50,r:20}, iPct:72, pace:138, paceNote:'good', fillers:2, length:'2:31', lengthNote:'good',
   strength:'You showed the commit half: you ran the renewal plan you had argued against until the bake-off finished.',
   fixes:['Add the one-line business impact: $290k saved.']},
].map(a => ({...a, ...v(a.verdict), fixList:a.fixes.map((t,i)=>({n:i+1,t})), hasBetter:!!a.better, hasMissed:a.missed.length>0, wePct:100-a.iPct, iFlag:a.iPct<50}));

export const TODAY_QUEUE = [
  {lp:'Dive Deep', why:'Not inclined last time', mins:12, verdict:3},
  {lp:'Earn Trust', why:'Not practised in 6 days', mins:10, verdict:2},
  {lp:'Think Big', why:'No strong story mapped', mins:15, verdict:3},
].map(t => ({...t, ...v(t.verdict)}));

export const FILES = [
  {name:'aws-sdm-jd.md', type:'JD', size:'6 KB', updated:'12 Sep', on:true},
  {name:'background.md', type:'Background', size:'4 KB', updated:'20 Sep', on:true},
  {name:'loop-2024-notes.md', type:'Past interviews', size:'11 KB', updated:'28 Sep', on:true},
  {name:'phone-screen-feedback.md', type:'Past interviews', size:'2 KB', updated:'28 Sep', on:true},
  {name:'reading-list.md', type:'Other', size:'1 KB', updated:'2 Oct', on:false},
];

export const COVERAGE = {covered:13, total:16, gaps:LPS.filter(l=>l.stories===0).map(l=>l.name)};
