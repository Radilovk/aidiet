/*
 * Дизайн одит на клиентските екрани: контраст (WCAG AA), текст под 12px,
 * зони за докосване под 44px, хоризонтално преливане при 320px, бутони без име.
 * Всеки екран се зарежда при 320 и 390px, в светла и тъмна тема, с тестов план.
 *
 *   python3 -m http.server 8765        # от корена на репото
 *   node scripts/design-audit.mjs      # → design-audit.json + design-audit-shots/
 *   node scripts/design-audit.mjs '{"plan_chat":{"url":"plan.html","acts":[{"js":"openChat()"}]}}'
 *
 * Нужен е пакетът playwright (не е в зависимостите на проекта).
 * Сигналите се преглеждат ръчно: скрити менюта, неактивни бутони и текст
 * с градиентна заливка дават фалшиви нарушения.
 */
import { chromium } from 'playwright';
import fs from 'fs';
const meals=()=>[
 {type:'Закуска',name:'Овесена каша с боровинки и орехи',weight:'320 г',calories:420,macros:{protein:18,carbs:55,fats:14},description:'Овес, мляко, боровинки, орехи',benefits:'Фибри'},
 {type:'Обяд',name:'Пилешко филе на скара със салата',weight:'450 г',calories:560,macros:{protein:45,carbs:30,fats:22},description:'Пиле, домати',benefits:'Белтък'},
 {type:'Следобедна закуска',name:'Кисело мляко с ябълка',weight:'250 г',calories:210,macros:{protein:10,carbs:28,fats:6}},
 {type:'Вечеря',name:'Сьомга с броколи и киноа',weight:'400 г',calories:540,macros:{protein:38,carbs:35,fats:24}}];
const wp={}; for(let i=1;i<=7;i++) wp['day'+i]={meals:meals()};
const plan={weekPlan:wp,summary:{dailyCalories:1730,macros:{protein:111,carbs:148,fats:66}},recommendations:['Пий вода','Яж зеленчуци'],forbidden:['Захар']};
const userData={name:'Иван',age:35,gender:'Мъж',weight:85,height:180,goal:'Отслабване'};
plan.analysis={currentHealthStatus:{score:62,description:'Умерено наднормено тегло, висок стрес.'},keyProblems:[{title:'Наднормено тегло',category:'Metabolic',severity:'Risky',severityValue:70,description:'ИТМ 26.2',impact:'Повишен риск'},{title:'Хроничен стрес',category:'Psychological',severity:'Borderline',severityValue:55,description:'Висок стрес',impact:'Преяждане'},{title:'Сън',category:'Lifestyle',severity:'Normal',severityValue:20,description:'7-8 ч',impact:''}],forecastOptimistic:'−8 кг за 12 седмици',forecastPessimistic:'+3 кг за година'};
const SCREENS=['index.html','plan.html','guidelines.html','game-analytics.html','profile.html','questionnaire2.html','warning.html','analysis-loading.html','analysis.html','plan-pending.html','plan-update.html','plan-book.html','food-picker.html','emoeat.html','longevity.html','kids.html','protocol-landing.html','features.html','privacy-policy.html','terms.html'];
const STATES=process.argv[2]?JSON.parse(process.argv[2]):Object.fromEntries(SCREENS.map(u=>[u.replace('.html',''),{url:u,acts:[]}]));
fs.mkdirSync('design-audit-shots',{recursive:true});const PAGES=Object.keys(STATES);
const b=await chromium.launch();
const out={};
for (const page of PAGES){
 out[page]={};
 for (const theme of ['light','dark']) for (const w of [320,390]){
  const ctx=await b.newContext({viewport:{width:w,height:800},deviceScaleFactor:2});
  await ctx.addInitScript(([p,u,t])=>{try{localStorage.setItem('dietPlan',p);localStorage.setItem('userId','demo_1');localStorage.setItem('clientId','demo_1');localStorage.setItem('userData',u);localStorage.setItem('theme',t);localStorage.setItem('planUpdatedAt','1');}catch(e){}},[JSON.stringify(plan),JSON.stringify(userData),theme]);
  const pg=await ctx.newPage();
  await pg.route(u=>!u.href.startsWith('http://localhost')&&!/fonts\.g|cdnjs|jsdelivr|unpkg/.test(u.href),r=>r.abort());
  try{await pg.goto('http://localhost:8765/'+STATES[page].url,{waitUntil:'load',timeout:20000});}catch(e){}
  await pg.waitForTimeout(3000);
  await pg.evaluate(()=>{document.querySelectorAll('[id^=npPlanEditing]').forEach(e=>(e.closest('[role=dialog]')||e).remove());});
  for(const a of STATES[page].acts){try{if(a.click){await pg.click(a.click,{timeout:3000});}if(a.fill){await pg.fill(a.fill[0],a.fill[1]);}if(a.js){await pg.evaluate(a.js);}await pg.waitForTimeout(a.wait||800);}catch(e){console.error(page,'act fail',JSON.stringify(a),e.message.split('\n')[0]);}}
  await pg.evaluate(()=>{document.querySelectorAll('[id^=npPlanEditing]').forEach(e=>(e.closest('[role=dialog]')||e).remove()); document.body.style.opacity='1';});
  const r=await pg.evaluate(()=>{
   const parse=s=>{const m=s.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p[3]===undefined?1:p[3]];};
   const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
   const blend=(top,bot)=>{const a=top[3];return [top[0]*a+bot[0]*(1-a),top[1]*a+bot[1]*(1-a),top[2]*a+bot[2]*(1-a),1];};
   const cr=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
   function bgs(el){ // returns list of candidate opaque backgrounds
     let layers=[]; let e=el;
     while(e&&e.nodeType===1){const cs=getComputedStyle(e);
       if(cs.backgroundImage&&cs.backgroundImage.includes('gradient')){const cols=(cs.backgroundImage.match(/rgba?\([^)]+\)/g)||[]).map(parse).filter(c=>c&&c[3]>0.5);if(cols.length){return {layers,base:cols,grad:true};}}
       const c=parse(cs.backgroundColor); if(c&&c[3]>0){layers.push(c); if(c[3]>=0.98) return {layers,base:null};}
       e=e.parentElement;}
     return {layers,base:null};
   }
   function effBg(el){const {layers,base,grad}=bgs(el);const bases=base||[[255,255,255,1]];
     if(!base){const t=document.documentElement.getAttribute('data-theme');if(t==='dark'&&!layers.some(l=>l[3]>=0.98))bases[0]=[11,18,32,1];}
     return {list:bases.map(bb=>{let c=bb;for(let i=layers.length-1;i>=0;i--)c=blend(layers[i],c);return c;}),grad:!!grad};}
   const vis=e=>{const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)return false;let p=e;while(p){if(+getComputedStyle(p).opacity<0.05)return false;p=p.parentElement;}return true;};
   const contrast=[],small=[],targets=[];
   const all=[...document.body.querySelectorAll('*')];
   for(const el of all){
     if(['SCRIPT','STYLE','NOSCRIPT','SVG','PATH'].includes(el.tagName))continue;
     const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
     if(txt&&vis(el)){
       const cs=getComputedStyle(el);const fs=parseFloat(cs.fontSize);const bold=+cs.fontWeight>=700;
       const col=parse(cs.color); if(!col)continue;
       const {list,grad}=effBg(el); let worst=99; for(const bg of list){const c=cr(blend(col,bg),bg);worst=Math.min(worst,c);} 
       const large=fs>=24||(fs>=18.66&&bold); const need=large?3:4.5;
       const label=(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/)[0]:el.tagName.toLowerCase())+' «'+txt.slice(0,28)+'»';
       if(worst<need) contrast.push({label,ratio:+worst.toFixed(2),need,fs,grad});
       if(fs<12) small.push({label,fs});
     }
   }
   const inter=document.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]),select,textarea,[onclick]');
   for(const el of inter){ if(!vis(el))continue; const r=el.getBoundingClientRect();
     if(el.tagName==='A'&&getComputedStyle(el).display==='inline'&&el.closest('p,li'))continue;
     if(r.width<44||r.height<44){targets.push({label:(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/)[0]:el.tagName.toLowerCase())+' «'+(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,22)+'»',w:Math.round(r.width),h:Math.round(r.height)});}}
   const overflow=document.documentElement.scrollWidth>window.innerWidth+1;
   const offenders=overflow?[...document.body.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.right>window.innerWidth+2&&vis(e)&&getComputedStyle(e).position!=='fixed';}).slice(0,4).map(e=>(e.className&&typeof e.className==='string'?'.'+e.className.split(' ')[0]:e.tagName)):[];
   const unnamed=[...document.querySelectorAll('button,[role=button],a[href]')].filter(e=>vis(e)&&!(e.getAttribute('aria-label')||e.textContent.trim()||e.getAttribute('title')||e.querySelector('img[alt]:not([alt=""])'))).map(e=>'.'+(typeof e.className==='string'?e.className.split(' ')[0]:'')).slice(0,8);
   const dedupe=a=>{const m=new Map();for(const x of a){if(!m.has(x.label))m.set(x.label,x);}return [...m.values()];};
   return {title:document.title,height:document.documentElement.scrollHeight,contrast:dedupe(contrast).sort((a,b)=>a.ratio-b.ratio),small:dedupe(small),targets:dedupe(targets),overflow,offenders,unnamed,h1:[...document.querySelectorAll('h1,h2')].filter(vis).slice(0,3).map(h=>Math.round(parseFloat(getComputedStyle(h).fontSize))+'px')};
  });
  out[page][theme+w]=r;
  if(w===390) await pg.screenshot({path:`design-audit-shots/${theme}-${page}.png`});
  await ctx.close();
 }
 console.error('done',page);
}
await b.close();
fs.writeFileSync('design-audit.json',JSON.stringify(out,null,1));
