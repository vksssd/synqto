import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual:true, url:'https://leetcode.com/problems/two-sum/' });
const w = dom.window;
for (const k of ['window','document','HTMLElement','Element','Node','SVGElement','MouseEvent','Event','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','DOMParser']) globalThis[k]=w[k];
globalThis.self=w;
const store={};
globalThis.chrome={runtime:{id:'t',sendMessage:async()=>({success:true}),onMessage:{addListener(){}},getManifest:()=>({version:'0.14.0'}),getURL:p=>p},
 storage:{local:{get:(k,cb)=>{const r={};(Array.isArray(k)?k:[k]).forEach(x=>r[x]=store[x]);cb&&cb(r);return Promise.resolve(r);},
 set:(o,cb)=>{Object.assign(store,o);cb&&cb();return Promise.resolve();},remove:()=>Promise.resolve()},onChanged:{addListener(){}}},tabs:{query:(q,cb)=>cb&&cb([])}};
w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},rect(){},closePath(){},setTransform(){},scale(){},translate(){},fillRect(){},createLinearGradient:()=>({addColorStop(){}}),measureText:()=>({width:10}),fillText(){},strokeRect(){},clip(){},drawImage(){},createPattern:()=>null,quadraticCurveTo(){},bezierCurveTo(){},ellipse(){},setLineDash(){},roundRect(){},set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){},set font(v){},set globalAlpha(v){}});

const mod = await import('./src/content/floating-widget.ts');
const Cls = Object.values(mod).find(v=>typeof v==='function');
const widget = new Cls();
await new Promise(r=>setTimeout(r,300));
widget.settings.clickAction='open_popup';
await new Promise(r=>setTimeout(r,400));
const sh = [...w.document.body.children].map(h=>h.shadowRoot).find(Boolean);
const q = id => sh.getElementById(id);

// Identity of the popup card tells us whether the subtree was rebuilt.
const cardId = () => q('nb-popup-card');
const click = id => q(id)?.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const settle = () => new Promise(r=>setTimeout(r,120));

let before, after;

before = cardId();
click('nb-fab-trigger'); await settle();
after = cardId();
console.log('FAB open      -> rebuilt DOM?', before !== after, '| open =', after?.className.includes('is-open'));

before = cardId();
click('nb-close-popup'); await settle();
after = cardId();
console.log('X close       -> rebuilt DOM?', before !== after, '| open =', after?.className.includes('is-open'));

click('nb-fab-trigger'); await settle();
before = cardId();
sh.querySelector('.size-mode-pill[data-popsize="large"]')?.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
await settle();
after = cardId();
console.log('size change   -> rebuilt DOM?', before !== after);

before = cardId();
click('nb-tab-whiteboard'); await settle();
after = cardId();
console.log('tab switch    -> rebuilt DOM?', before !== after, '(expected: true, content differs)');
process.exit(0);
