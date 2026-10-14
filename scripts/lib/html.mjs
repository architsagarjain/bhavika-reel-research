// Shared look and client helpers for the two viewers (out/library.html and reports/<stamp>.html).
// Self-contained pages: no external requests, data inlined as JSON, every string rendered with textContent (XSS-safe).
import { escapeHtml, jsonForScript } from "./util.mjs";

export const BASE_CSS = `
:root{
  --bg:#070807;--bg2:#0C0E0B;--card:#151813;--card2:#1B1F18;
  --line:rgba(245,244,236,.08);--line2:rgba(245,244,236,.16);
  --text:#F5F4EC;--muted:rgba(245,244,236,.64);--faint:rgba(245,244,236,.42);
  --lime:#9CFF1E;--lime-ink:#0B1400;--lime-soft:rgba(156,255,30,.12);
  --champ:#EED67F;--champ-ink:#231B00;--warn:#FF7A7A;--warn-soft:rgba(255,122,122,.14);
  --radius:18px;--shadow:0 1px 0 rgba(255,255,255,.03) inset,0 18px 40px -18px rgba(0,0,0,.8);
  color-scheme:dark;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;color:var(--text);font:15px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  background:radial-gradient(900px 520px at 8% -8%,rgba(156,255,30,.075),transparent 62%),radial-gradient(700px 480px at 100% 0%,rgba(238,214,127,.045),transparent 60%),var(--bg);background-attachment:fixed;-webkit-font-smoothing:antialiased}
a{color:inherit}
button,input,select{font:inherit;color:inherit}
.wrap{max-width:1360px;margin:0 auto;padding:40px 28px 96px}
.brand{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.01em}
.brand i{width:10px;height:10px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 4px rgba(156,255,30,.14),0 0 18px rgba(156,255,30,.55)}
.eyebrow{margin-top:26px;color:var(--lime);font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase}
h1{margin:8px 0 8px;font-size:clamp(28px,4vw,42px);line-height:1.06;letter-spacing:-.025em;font-weight:750}
.sub{color:var(--muted);max-width:820px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:26px 0 22px}
.tile{background:linear-gradient(180deg,var(--card),var(--bg2));border:1px solid var(--line);border-radius:16px;padding:14px 16px;box-shadow:var(--shadow)}
.tile b{display:block;font-size:24px;letter-spacing:-.02em;font-weight:700}
.tile span{color:var(--faint);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em}
.tile.accent b{color:var(--lime)}.tile.hot b{color:var(--champ)}
.bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 -28px 22px;padding:12px 28px;background:rgba(7,8,7,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 420px}
.chip{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--line2);background:var(--bg2);color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.chip:hover{color:var(--text);border-color:rgba(245,244,236,.3)}
.chip small{color:var(--faint);font-weight:600}
.chip[aria-pressed="true"]{background:var(--lime);border-color:var(--lime);color:var(--lime-ink)}
.chip[aria-pressed="true"] small{color:rgba(11,20,0,.6)}
.ctl{height:34px;border-radius:10px;border:1px solid var(--line2);background:var(--bg2);padding:0 12px;font-size:13px}
.ctl:focus,.chip:focus-visible,.btn:focus-visible,.card:focus-visible{outline:2px solid var(--lime);outline-offset:2px}
input.ctl{width:220px}
label.toggle{display:inline-flex;gap:8px;align-items:center;color:var(--muted);font-size:13px;cursor:pointer}
label.toggle input{accent-color:var(--lime);width:16px;height:16px}
.count{color:var(--faint);font-size:13px;margin-left:auto;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:18px}
.card{position:relative;display:flex;flex-direction:column;background:var(--bg2);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform .18s ease,border-color .18s ease}
.card:hover{transform:translateY(-3px);border-color:var(--line2)}
.cover{position:relative;aspect-ratio:9/16;overflow:hidden;background:#11140f}
.cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.cover::after{content:"";position:absolute;inset:auto 0 0 0;height:46%;background:linear-gradient(to top,rgba(7,8,7,.92),rgba(7,8,7,0));pointer-events:none}
.pill{position:absolute;z-index:2;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:750;letter-spacing:.01em;background:rgba(7,8,7,.62);color:var(--text);border:1px solid rgba(245,244,236,.14);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.pill.tl{top:10px;left:10px}.pill.tr{top:10px;right:10px;font-weight:600;color:var(--muted)}.pill.bl{bottom:10px;left:10px}
.pill.lime{background:var(--lime);color:var(--lime-ink);border-color:transparent}
.pill.hot{background:var(--champ);color:var(--champ-ink);border-color:transparent;box-shadow:0 0 22px rgba(238,214,127,.35)}
.pill.warn{background:var(--warn-soft);color:var(--warn);border-color:rgba(255,122,122,.35)}
.over{position:absolute;z-index:2;left:12px;right:12px;bottom:12px}
.body{display:flex;flex-direction:column;gap:9px;padding:14px 15px 15px;flex:1}
.who{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.who b{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who span{color:var(--faint);white-space:nowrap}
.clamp2,.clamp3{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.clamp2{-webkit-line-clamp:2}.clamp3{-webkit-line-clamp:3}
.stats{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--faint)}
.stats b{color:var(--text);font-weight:650}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:var(--card2);color:var(--muted);border:1px solid var(--line)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:11px;border:1px solid var(--line2);background:var(--card);color:var(--text);font-size:13px;font-weight:650;text-decoration:none;cursor:pointer;transition:filter .15s,background .15s}
.btn:hover{filter:brightness(1.15)}
.btn.primary{background:var(--lime);border-color:var(--lime);color:var(--lime-ink)}
.muted{color:var(--muted)}.faint{color:var(--faint)}
.empty{grid-column:1/-1;padding:60px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line2);border-radius:var(--radius)}
.note{margin-top:40px;color:var(--faint);font-size:13px;max-width:900px;line-height:1.6}
.note b{color:var(--muted)}
.banner{display:flex;gap:12px;align-items:center;margin:22px 0 0;padding:12px 16px;border-radius:14px;background:var(--lime-soft);border:1px solid rgba(156,255,30,.28);color:var(--text);font-size:14px}
.banner b{color:var(--lime)}
@media (max-width:640px){.wrap{padding:28px 16px 80px}.bar{margin:0 -16px 18px;padding:10px 16px}input.ctl{width:100%}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.body{padding:11px 12px 12px}.count{margin-left:0}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/** Client-side helpers shared by both viewers. Builds DOM with textContent only; URLs are allow-listed. */
export const CLIENT_LIB = `
const $=(s,el=document)=>el.querySelector(s);
function safeUrl(u){u=String(u==null?'':u).trim();return /^https?:\\/\\//i.test(u)?u:null}
function safeImg(u){u=String(u==null?'':u).trim();if(/^https?:\\/\\//i.test(u))return u;if(/^data:image\\/(png|jpe?g|webp|gif|svg\\+xml);base64,[A-Za-z0-9+\\/=]+$/i.test(u))return u;if(/^(\\.\\.\\/)*[A-Za-z0-9._\\/-]+$/.test(u)&&u.indexOf(':')<0)return u;return null}
function h(tag,attrs){const el=document.createElement(tag);if(attrs)for(const k in attrs){const v=attrs[k];if(v==null||v===false)continue;if(k==='class')el.className=v;else if(k==='text')el.textContent=String(v);else if(k.slice(0,2)==='on'&&typeof v==='function')el.addEventListener(k.slice(2),v);else if(k==='href'){const u=safeUrl(v);if(u)el.setAttribute('href',u)}else if(k==='src'){const u=safeImg(v);if(u)el.setAttribute('src',u)}else el.setAttribute(k,v===true?'':String(v))}for(let i=2;i<arguments.length;i++){const kids=[].concat(arguments[i]);for(const kid of kids){if(kid==null||kid===false)continue;el.append(kid.nodeType?kid:document.createTextNode(String(kid)))}}return el}
function fmt(n){if(n==null||!isFinite(n))return 'n/a';const a=Math.abs(n);if(a>=1e6)return (n/1e6).toFixed(a>=1e7?0:1).replace(/\\.0$/,'')+'M';if(a>=1e3)return (n/1e3).toFixed(a>=1e4?0:1).replace(/\\.0$/,'')+'K';return String(Math.round(n))}
function pct(r){return r==null||!isFinite(r)?'n/a':(r*100).toFixed(r>=.1?1:2).replace(/\\.0+$/,'')+'%'}
function ago(hrs){if(hrs==null||!isFinite(hrs))return '';if(hrs<1)return Math.max(1,Math.round(hrs*60))+'m ago';if(hrs<48)return Math.round(hrs)+'h ago';return Math.round(hrs/24)+'d ago'}
function mmss(t){t=Math.max(0,Number(t)||0);const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+String(s).padStart(2,'0')}
function day(iso){if(!iso)return '';const d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
const GRADS=[['#1f3a0c','#0b1405','#9CFF1E'],['#3b3110','#120f05','#EED67F'],['#0e2d29','#050f0d','#5EF2C4'],['#26301b','#0a0d07','#C8F27A'],['#2e2a17','#0d0c06','#F1E3A6'],['#16261c','#070d09','#8FE3A8']];
function gradFor(id){let x=0;const s=String(id||'');for(let i=0;i<s.length;i++)x=(x*31+s.charCodeAt(i))>>>0;const g=GRADS[x%GRADS.length];return 'radial-gradient(120% 70% at 20% 10%,'+g[2]+'33,transparent 60%),linear-gradient(165deg,'+g[0]+','+g[1]+')'}
function coverEl(src,id,alt){const box=h('div',{class:'cover'});box.style.background=gradFor(id);const ok=safeImg(src);if(ok){const img=h('img',{src:ok,alt:alt||'',loading:'lazy',decoding:'async',referrerpolicy:'no-referrer'});img.addEventListener('error',()=>img.remove());box.append(img)}return box}
function readData(){return JSON.parse(document.getElementById('irt-data').textContent)}
`;

/** Full HTML page. `data` is inlined as JSON (safe inside the script tag); `script` runs after CLIENT_LIB. */
export function page({ title, description = "", css = "", data, script }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<style>${BASE_CSS}${css}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="irt-data">${jsonForScript(data)}</script>
<script>
"use strict";
${CLIENT_LIB}
${script}
</script>
</body>
</html>
`;
}
