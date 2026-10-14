#!/usr/bin/env node
// Build out/library.html: every analyzed reel (library/reels/*.json) in one self-contained page.
// Click a card for the full breakdown: hook, transcript, format, angle, frame by frame notes, numbers, your version.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { page } from "./lib/html.mjs";
import { HOT_OUTLIER, validateReelEntry } from "./lib/schema.mjs";
import { PATHS, cli, coverSrc, openFile, rel, resolvePath, tryReadJson, writeText } from "./lib/util.mjs";

const USAGE = `Build the reel library viewer.

Usage:
  node scripts/build-library.mjs [options]

Options:
  --dir DIR      library folder (default library/reels; falls back to samples/library when empty)
  --out FILE     output file (default out/library.html)
  --samples      show the sample reels even if you have your own
  --open         open it in your browser
  -h, --help     show this help`;

const LIBRARY_CSS = `
.card{cursor:pointer;text-align:left;padding:0;font:inherit;color:inherit}
.hookline{font-size:15px;font-weight:650;line-height:1.35;letter-spacing:-.005em}
.over .who b{font-size:13px}
.backdrop{position:fixed;inset:0;z-index:40;background:rgba(3,4,3,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .2s}
.backdrop.open{opacity:1;pointer-events:auto}
.panel{position:fixed;z-index:50;top:0;right:0;bottom:0;width:min(760px,100vw);background:var(--bg2);border-left:1px solid var(--line2);box-shadow:-30px 0 80px rgba(0,0,0,.6);transform:translateX(102%);transition:transform .28s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column}
.panel.open{transform:none}
.phead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line)}
.phead .t{font-size:13px;color:var(--faint);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.x{width:36px;height:36px;border-radius:10px;border:1px solid var(--line2);background:var(--card);color:var(--text);font-size:18px;cursor:pointer}
.pbody{overflow-y:auto;padding:22px 22px 60px;display:flex;flex-direction:column;gap:18px;overscroll-behavior:contain}
.top{display:flex;gap:16px;align-items:flex-start}
.top .cover{width:104px;flex:none;border-radius:12px;border:1px solid var(--line)}
.top .cover::after{display:none}
.top h2{margin:2px 0 6px;font-size:22px;letter-spacing:-.02em}
.top .meta{color:var(--faint);font-size:13px;display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:12px}
.nums{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.num{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.num b{display:block;font-size:18px;letter-spacing:-.01em}
.num span{font-size:10.5px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.1em}
.num.na b{color:var(--faint)}
.num.hot b{color:var(--champ)}
.sec{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.sec h3{margin:0 0 12px;font-size:11px;color:var(--faint);font-weight:700;letter-spacing:.16em;text-transform:uppercase;display:flex;justify-content:space-between;gap:10px}
.sec h3 em{font-style:normal;color:var(--muted);letter-spacing:.04em;text-transform:none;font-weight:600}
.hook{border-color:rgba(156,255,30,.35);background:linear-gradient(180deg,rgba(156,255,30,.07),var(--card) 70%)}
.hooktext{font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-.015em;margin:0 0 14px}
.hooktext mark{background:rgba(156,255,30,.18);color:var(--lime);border-radius:5px;padding:0 3px;box-shadow:inset 0 -2px 0 rgba(156,255,30,.6)}
.kv{display:grid;grid-template-columns:130px 1fr;gap:8px 14px;font-size:14px}
.kv dt{color:var(--faint)}.kv dd{margin:0}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:6px 9px;display:inline-block}
.p{margin:12px 0 0;color:var(--muted);font-size:14px;line-height:1.6}
.rows{display:flex;flex-direction:column;gap:12px}
.row{display:grid;grid-template-columns:54px 1fr;gap:12px;align-items:start}
.time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;color:var(--lime);background:var(--lime-soft);border-radius:7px;padding:3px 0;text-align:center}
.row b{display:block;font-size:14px;font-weight:650}
.row .muted{font-size:13.5px}
.ost{display:inline-block;margin:4px 0;font-size:12.5px;font-weight:650;color:var(--champ);border:1px solid rgba(238,214,127,.3);border-radius:7px;padding:2px 8px}
.timeline .row{position:relative}
.timeline .row:not(:last-child)::after{content:"";position:absolute;left:26px;top:28px;bottom:-14px;width:1px;background:var(--line2)}
.tr{display:grid;grid-template-columns:54px 1fr;gap:12px;font-size:14.5px;line-height:1.55;padding:4px 0}
.tr.h{color:var(--text)}.tr:not(.h){color:var(--muted)}
.tr.h .time{background:var(--lime);color:var(--lime-ink)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.belief{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:12px}
.belief span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
.belief.c{border-color:rgba(156,255,30,.3)}.belief.c span{color:var(--lime)}
.mine pre{white-space:pre-wrap;font:inherit;font-size:14.5px;line-height:1.6;margin:10px 0 0;color:var(--muted)}
.mine .mh{font-size:17px;font-weight:700;color:var(--text)}
details.sec summary{cursor:pointer;color:var(--muted);font-size:13px;font-weight:600}
.foot{color:var(--faint);font-size:12px}
@media (max-width:640px){.nums{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.kv{grid-template-columns:1fr}.hooktext{font-size:20px}.pbody{padding:18px 16px 60px}}
`;

const LIBRARY_JS = `
const D=readData();const R=D.reels;
const app=document.getElementById('app');
const state={sort:'added',fmt:null,q:''};
const wrap=h('div',{class:'wrap'});
const views=R.reduce((a,r)=>a+(r.stats.views||0),0);
const hot=R.filter(r=>r.stats.outlierScore!=null&&r.stats.outlierScore>=D.hot).length;
wrap.append(
  h('div',{class:'brand'},h('i'),'Instagram Research Tool'),
  D.sample?h('div',{class:'banner'},h('b',{text:'Sample data.'}),'These reels are made up so you can see the layout. Research your first reel with /reel-research <url> in Claude Code, then run npm run library.'):'',
  h('div',{class:'eyebrow',text:'Reel library'}),
  h('h1',{text:'Every reel you studied, broken down'}),
  h('div',{class:'sub',text:'Hook, transcript, format, angle, numbers and a frame by frame breakdown for each reel. Keep the idea, rewrite it in your own voice.'}),
  h('div',{class:'tiles'},
    h('div',{class:'tile accent'},h('b',{text:String(R.length)}),h('span',{text:'reels studied'})),
    h('div',{class:'tile hot'},h('b',{text:String(hot)}),h('span',{text:D.hot+'x outliers'})),
    h('div',{class:'tile'},h('b',{text:fmt(views)}),h('span',{text:'total views'})),
    h('div',{class:'tile'},h('b',{text:String(new Set(R.map(r=>r.creator)).size)}),h('span',{text:'creators'}))
  )
);
const fmts={};R.forEach(r=>{const c=(r.format.category||'').trim();if(c)fmts[c]=(fmts[c]||0)+1});
const chips=h('div',{class:'chips',role:'group','aria-label':'Filter by format'});
function chip(id,label,n){const b=h('button',{class:'chip',type:'button','aria-pressed':String(state.fmt===id)},label,h('small',{text:String(n)}));b.addEventListener('click',()=>{state.fmt=state.fmt===id?null:id;render()});return b}
const sort=h('select',{class:'ctl','aria-label':'Sort'},h('option',{value:'added',text:'Recently added'}),h('option',{value:'outlier',text:'Top outlier'}),h('option',{value:'views',text:'Most views'}),h('option',{value:'er',text:'Best engagement'}));
sort.addEventListener('change',()=>{state.sort=sort.value;render()});
const q=h('input',{class:'ctl',type:'search',placeholder:'Search hook, topic, creator','aria-label':'Search'});
q.addEventListener('input',()=>{state.q=q.value.trim().toLowerCase();render()});
const count=h('span',{class:'count'});
wrap.append(h('div',{class:'bar'},chips,sort,q,count));
const grid=h('div',{class:'grid'});wrap.append(grid);
wrap.append(h('div',{class:'note'},h('b',{text:'Built for research, not copying. '}),'Study why a reel works, keep the topic or the structure, and write your own version in your voice. Covers and numbers come from your data provider; nothing here logs in to Instagram.'));
app.append(wrap);
const backdrop=h('div',{class:'backdrop'});
const pbody=h('div',{class:'pbody'});
const closeBtn=h('button',{class:'x',type:'button','aria-label':'Close',text:'\\u00d7'});
const ptitle=h('span',{class:'t',text:'Reel breakdown'});
const panel=h('aside',{class:'panel',role:'dialog','aria-modal':'true','aria-label':'Reel breakdown',tabindex:'-1'},h('div',{class:'phead'},ptitle,closeBtn),pbody);
document.body.append(backdrop,panel);
let lastFocus=null;
function close(){panel.classList.remove('open');backdrop.classList.remove('open');if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(lastFocus)lastFocus.focus()}
closeBtn.addEventListener('click',close);backdrop.addEventListener('click',close);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open'))close()});
function markPower(text,words){const p=h('p',{class:'hooktext'});const list=(words||[]).filter(Boolean).sort((a,b)=>b.length-a.length);if(!list.length){p.textContent=text;return p}
  const esc=s=>s.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');const re=new RegExp('('+list.map(esc).join('|')+')','gi');
  String(text).split(re).forEach((part,i)=>{if(!part)return;p.append(i%2?h('mark',{text:part}):document.createTextNode(part))});return p}
function num(label,v,cls){return h('div',{class:'num'+(v==null?' na':'')+(cls?' '+cls:'')},h('b',{text:v==null?'n/a':v}),h('span',{text:label}))}
function sec(title,extra,...kids){return h('section',{class:'sec'},h('h3',null,title,extra?h('em',{text:extra}):null),...kids)}
function kv(pairs){const dl=h('dl',{class:'kv'});pairs.filter(p=>p[1]).forEach(p=>dl.append(h('dt',{text:p[0]}),h('dd',{text:p[1]})));return dl.childNodes.length?dl:null}
function open(r){
  lastFocus=document.activeElement;
  const s=r.stats,hk=r.hook;
  const isHot=s.outlierScore!=null&&s.outlierScore>=D.hot;
  const cov=coverEl(r.coverSrc,r.id,'Cover');
  pbody.replaceChildren(
    h('div',{class:'top'},cov,h('div',{style:'min-width:0;flex:1'},
      h('h2',{text:'@'+(r.creator||'unknown')}),
      h('div',{class:'meta'},r.postedAt?h('span',{text:'Posted '+day(r.postedAt)}):null,r.durationSec!=null?h('span',{text:Math.round(r.durationSec)+'s'}):null,h('span',{text:r.platform}),r.format.category?h('span',{text:r.format.category}):null),
      r.url?h('a',{class:'btn primary',href:r.url,target:'_blank',rel:'noopener noreferrer',text:'Open original \\u2197'}):null)),
    h('div',{class:'nums'},num('Views',s.views==null?null:fmt(s.views)),num('Likes',s.likes==null?null:fmt(s.likes)),num('Comments',s.comments==null?null:fmt(s.comments)),num('Shares',s.shares==null?null:fmt(s.shares)),num('Saves',s.saves==null?null:fmt(s.saves)),num('Engagement',s.engagementRate==null?null:pct(s.engagementRate)),num('Outlier',s.outlierScore==null?null:s.outlierScore+'x',isHot?'hot':''),num('Hook',hk.seconds?hk.seconds+'s':null)),
    hk.text?h('section',{class:'sec hook'},h('h3',null,'Hook',h('em',{text:[hk.words?hk.words+' words':'',hk.seconds?'0 to '+hk.seconds+'s':'',hk.category].filter(Boolean).join(' \\u00b7 ')})),markPower(hk.text,hk.powerWords),
      hk.template?h('div',null,h('span',{class:'mono',text:hk.template})):null,
      hk.whyItWorks?h('p',{class:'p'},h('b',{style:'color:var(--text)',text:'Why it works. '}),hk.whyItWorks):null):null,
    r.scrollStoppers.length?sec('Scroll stoppers',r.scrollStoppers.length+' moments',h('div',{class:'rows'},r.scrollStoppers.map(x=>h('div',{class:'row'},h('span',{class:'time',text:mmss(x.t)}),h('div',null,h('b',{text:x.moment}),h('div',{class:'muted',text:x.why})))))):null,
    r.visualBreakdown.length?sec('Visual breakdown','frame by frame',h('div',{class:'rows timeline'},r.visualBreakdown.map(x=>h('div',{class:'row'},h('span',{class:'time',text:mmss(x.t)}),h('div',null,h('b',{text:x.shot}),x.onScreenText?h('span',{class:'ost',text:x.onScreenText}):null,h('div',{class:'muted',text:x.why})))))):null,
    (r.format.category||r.format.reasoning)?sec('Format',null,kv([['Category',r.format.category],['Type',r.format.type],['Layout',r.format.visualLayout],['Pacing',r.format.pacing]]),r.format.reasoning?h('p',{class:'p',text:r.format.reasoning}):null):null,
    (r.angle.topic||r.angle.angle)?sec('Angle',null,kv([['Topic',r.angle.topic],['Angle',r.angle.angle]]),(r.angle.commonBelief||r.angle.contrarianTake)?h('div',{class:'two'},h('div',{class:'belief'},h('span',{text:'Common belief'}),r.angle.commonBelief||''),h('div',{class:'belief c'},h('span',{text:'Contrarian take'}),r.angle.contrarianTake||'')):null):null,
    r.transcript.length?sec('Transcript',r.source.transcriptTiming==='estimated'?'timing estimated':r.transcript.length+' lines',h('div',null,r.transcript.map(t=>h('div',{class:'tr'+(hk.seconds&&t.start<hk.seconds?' h':'')},h('span',{class:'time',text:mmss(t.start)}),h('span',{text:t.text}))))):null,
    (r.myVersion.hook||r.myVersion.script)?h('section',{class:'sec mine'},h('h3',null,'My version',h('em',{text:'your words, your voice'})),r.myVersion.hook?h('div',{class:'mh',text:r.myVersion.hook}):null,r.myVersion.script?h('pre',{text:r.myVersion.script}):null,
      h('div',{style:'margin-top:12px'},h('button',{class:'btn',type:'button',text:'Copy my version',onclick:function(){const t=[r.myVersion.hook,r.myVersion.script].filter(Boolean).join('\\n\\n');const b=this;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>{b.textContent='Copied'},()=>{b.textContent='Select and copy manually'})}}))):null,
    r.caption?h('details',{class:'sec'},h('summary',{text:'Original caption'}),h('p',{class:'p',text:r.caption})):null,
    h('div',{class:'foot',text:'Source: '+r.source.provider+' \\u00b7 fetched '+day(r.source.fetchedAt)+' \\u00b7 added '+day(r.addedAt)+' \\u00b7 id '+r.id})
  );
  pbody.scrollTop=0;
  panel.classList.add('open');backdrop.classList.add('open');
  if(location.hash!=='#'+r.id)history.replaceState(null,'','#'+r.id);
  closeBtn.focus();
}
const cmp={added:(a,b)=>String(b.addedAt).localeCompare(String(a.addedAt)),outlier:(a,b)=>(b.stats.outlierScore??-1)-(a.stats.outlierScore??-1),views:(a,b)=>(b.stats.views??-1)-(a.stats.views??-1),er:(a,b)=>(b.stats.engagementRate??-1)-(a.stats.engagementRate??-1)};
function card(r){
  const s=r.stats;const isHot=s.outlierScore!=null&&s.outlierScore>=D.hot;
  const cov=coverEl(r.coverSrc,r.id,'Cover of a reel by @'+r.creator);
  if(s.outlierScore!=null)cov.append(h('span',{class:'pill tl '+(isHot?'hot':s.outlierScore>=2?'lime':''),text:(isHot?'HOT ':'')+s.outlierScore+'x'}));
  if(r.durationSec!=null)cov.append(h('span',{class:'pill tr',text:Math.round(r.durationSec)+'s'}));
  cov.append(h('div',{class:'over'},h('div',{class:'who'},h('b',{text:'@'+(r.creator||'unknown')}),h('span',{text:fmt(s.views)+' views'}))));
  const el=h('button',{class:'card',type:'button','aria-label':'Open breakdown for @'+r.creator},cov,h('div',{class:'body'},
    h('div',{class:'hookline clamp2',text:r.hook.text?'\\u201c'+r.hook.text+'\\u201d':(r.caption||'Not analyzed yet')}),
    h('div',{class:'stats'},h('span',null,h('b',{text:pct(s.engagementRate)}),' eng.'),h('span',null,h('b',{text:fmt(s.likes)}),' likes'),h('span',null,h('b',{text:fmt(s.comments)}),' comments')),
    r.format.category||r.angle.topic?h('div',{class:'tags'},r.format.category?h('span',{class:'tag',text:r.format.category}):null,r.angle.topic?h('span',{class:'tag',text:r.angle.topic}):null):null));
  el.addEventListener('click',()=>open(r));
  return el;
}
function render(){
  chips.replaceChildren(chip(null,'All',R.length),...Object.keys(fmts).sort().map(f=>chip(f,f,fmts[f])));
  let rows=R.filter(r=>(!state.fmt||r.format.category===state.fmt)&&(!state.q||[r.creator,r.hook.text,r.caption,r.angle.topic,r.format.category].join(' ').toLowerCase().includes(state.q)));
  rows=rows.slice().sort(cmp[state.sort]);
  count.textContent=rows.length+' of '+R.length+' reels';
  grid.replaceChildren(...(rows.length?rows.map(card):[h('div',{class:'empty',text:R.length?'No reels match.':'No reels yet. Research one with /reel-research <url> in Claude Code.'})]));
}
render();
function fromHash(){const id=decodeURIComponent(location.hash.slice(1));const r=id&&R.find(x=>x.id===id);if(r)open(r)}
window.addEventListener('hashchange',fromHash);fromHash();
`;

const { flags } = cli(USAGE, { boolean: ["open", "samples"], string: ["dir", "out"] });
const outFile = flags.out ? resolvePath(flags.out) : path.join(PATHS.out, "library.html");
const outDir = path.dirname(outFile);

function readEntries(dir) {
  if (!existsSync(dir)) return { entries: [], invalid: 0 };
  const entries = [];
  let invalid = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const e = tryReadJson(path.join(dir, f));
    const errors = e === undefined ? ["not valid JSON"] : validateReelEntry(e);
    if (errors.length) {
      invalid++;
      console.warn(`skip ${rel(path.join(dir, f))}: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ""}`);
      continue;
    }
    entries.push(e);
  }
  return { entries, invalid };
}

let dir = flags.dir ? resolvePath(flags.dir) : PATHS.library;
let { entries, invalid } = flags.samples ? { entries: [], invalid: 0 } : readEntries(dir);
let sample = false;
if (!entries.length && !flags.dir) {
  dir = path.join(PATHS.samples, "library");
  ({ entries, invalid } = readEntries(dir));
  sample = true;
}

const reels = entries.map((e) => ({ ...e, coverSrc: coverSrc(e.cover, outDir) }));
const html = page({
  title: "Reel Library",
  description: "Every reel you studied: hook, transcript, format, angle, numbers and frame by frame breakdown.",
  css: LIBRARY_CSS,
  data: { reels, sample, hot: HOT_OUTLIER, builtAt: new Date().toISOString() },
  script: LIBRARY_JS,
});
writeText(outFile, html);
console.log(`${rel(outFile)}: ${reels.length} reel(s) from ${rel(dir)}${sample ? " (sample data: your library/reels is empty)" : ""}${invalid ? `, ${invalid} invalid skipped` : ""}`);
if (flags.open) openFile(outFile);
