const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root,'static/js',name),'utf8');

function theme(initial={}) {
  const listeners={}, events={}, controls=[];
  const root={dataset:{},style:{}};
  const status={textContent:''};
  const media={matches:false,addEventListener(name,fn){this.change=fn;}};
  const document={documentElement:root,
    querySelectorAll(selector){return selector.includes('appearance')?controls:[];},
    querySelector(){return status;},
    addEventListener(name,fn){listeners[name]=fn;}};
  const window={POGO_APPEARANCE:initial,matchMedia:()=>media,
    dispatchEvent(event){events[event.type]=(events[event.type]||0)+1;}};
  const ctx={window,document,CustomEvent:class {constructor(type){this.type=type;}},
    fetch:async()=>({ok:true,json:async()=>({...window.PogoAppearance.current()})})};
  vm.runInNewContext(source('theme.js'),ctx);
  return {ctx,window,document,root,media,listeners,controls,status};
}

test('system mode reacts to OS changes, explicit mode stays fixed',()=>{
  const t=theme();
  assert.equal(t.root.dataset.theme,'light');
  t.media.matches=true;t.media.change();
  assert.equal(t.root.dataset.theme,'dark');
  const fixed=theme({theme:'light'});
  fixed.media.matches=true;fixed.media.change();
  assert.equal(fixed.root.dataset.theme,'light');
});
test('automatic team follows export and manual accent survives team changes',()=>{
  const t=theme({accent:'auto',team:'valor'});
  assert.equal(t.root.dataset.accent,'valor');
  t.window.PogoAppearance.updateTeam(3);
  assert.equal(t.root.dataset.accent,'instinct');
  const manual=theme({accent:'mystic',team:'valor'});
  manual.window.PogoAppearance.updateTeam(3);
  assert.equal(manual.root.dataset.accent,'mystic');
});
test('failed preference save restores previous appearance and shows error',async()=>{
  const t=theme();let changed;
  const control={value:'system',disabled:false,matches:()=>true,
    addEventListener(name,fn){changed=fn;}};
  t.controls.push(control);t.listeners.DOMContentLoaded();
  control.value='dark';
  t.ctx.fetch=async()=>({ok:false,json:async()=>({error:'Save failed'})});
  await changed();
  assert.equal(t.window.PogoAppearance.current().theme,'system');
  assert.equal(control.disabled,false);
  assert.equal(t.status.textContent,'Save failed');
});
async function assets() {
  const events={};
  const ctx={POGO_MDI:JSON.parse(fs.readFileSync(path.join(root,'static/mdi-icons.json'),'utf8')),
    addEventListener(name,fn){events['window:'+name]=fn;},
    Event:class {constructor(type){this.type=type;}},
    document:{addEventListener(name,fn){events[name]=fn;},querySelectorAll(){return [];},querySelector(){return null;}},
    fetch:async()=>({ok:true,json:async()=>({})})};
  ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(source('mdi.js'),ctx);vm.runInContext(source('pokeminers-data.js'),ctx);vm.runInContext(source('assets.js'),ctx);
  await ctx.assetReady;
  return {ctx,events};
}
test('remote references escape attributes and fall back to an MDI icon without image downloads',async()=>{
  const {ctx,events}=await assets();
  const html=ctx.gameAsset('item','Poké Ball');
  assert.match(html,/https:\/\/raw.githubusercontent.com\/PokeMiners\/pogo_assets\/master\/Images\/Items\/pokeball_sprite.png/);
  assert.match(ctx.gameAsset('pokemon','Pikachu',true,{pid:25}),/pm25.s.icon.png/);
  assert.doesNotMatch(ctx.gameAsset('pokemon','" onload="bad'),/alt="" onload/);
  assert.doesNotMatch(source('assets.js'),/createObjectURL|localStorage|serviceWorker|fetch\(['"]https/);
  let removed=false;
  events.error({target:{matches:selector=>selector==='.remote-game-art',dataset:{},parentElement:{classList:{add(){}},title:''},remove(){removed=true;}}});
  assert.ok(removed);assert.match(html,/mdi-icon/);
});
test('PokeMiners is the only asset provider',async()=>{
  const {ctx}=await assets();
  assert.match(ctx.gameAsset('pokemon','Pikachu',true,{pid:25}),/raw.githubusercontent.com/);
  assert.doesNotMatch(source('assets.js'),/api\/assets|catalog\.mode|local-assets|localStorage/);
});
test('all browser scripts parse and language toggles have been removed',()=>{
  for(const name of fs.readdirSync(path.join(root,'static/js'))){
    new vm.Script(source(name),{filename:name});
  }
  assert.doesNotMatch(source('app.js'),/_lang|applyLanguage|pogo_lang|pokemondb.net/);
});

test('PokeMiners resolves named forms, shiny sprites, item IDs, and name-only callers',async()=>{
  const {ctx}=await assets();
  assert.match(ctx.gameAsset('pokemon','Lapras',false,{pid:131,form:'LaprasNormal',gigantamax:true}),/pm131.fGIGANTAMAX.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Charizard',true,{pid:6,form:'CharizardMegaX'}),/pm6.fMEGA_X.s.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Zacian',false,{pid:888,form:'ZacianCrownedSword'}),/pm888.fCROWNED_SWORD.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Nidoran♀'),/pm29.icon.png|pokemon_icon_029_00.png/);
  assert.match(ctx.gameAsset('item','Potion',false,{id:101}),/Items\/Item_0101.png/);
  assert.doesNotMatch(ctx.gameAsset('pokemon','Pikachu'),/local-assets/);
  assert.doesNotMatch(ctx.gameAsset('pokemon','Unknown species',true,{pid:999999}),/remote-game-art/);
  assert.doesNotMatch(ctx.gameAsset('item','Unknown item',false,{id:999999}),/remote-game-art/);
});

test('failed form artwork advances to verified base artwork',async()=>{
  const {ctx,events}=await assets();
  const candidates=ctx.AssetLibrary.candidates('pokemon','Charizard',true,{pid:6,form:'CharizardMegaX'});
  assert.ok(candidates.length>1);
  const image={matches:selector=>selector==='.remote-game-art',dataset:{sources:JSON.stringify(candidates),sourceIndex:'0'}};
  events.error({target:image});assert.equal(image.src,candidates[1]);
});

test('status filters combine with search and shiny filter, and badges keep coexisting tags',()=>{
  const app=source('app.js');
  const ctx={S:{search:'latios',filter:'shiny',statusFilters:['purified','mega']},escapeHtml:value=>String(value),gameStatusIcon:()=>'',tagBadge:()=>''};
  const functions=['filterPoke','statusBadges'].map(name=>app.slice(app.indexOf('function '+name+'('),app.indexOf('\n}',app.indexOf('function '+name+'('))+2)).join('\n');
  vm.runInNewContext(functions,ctx);
  const pokemon={name:'Latios',shiny:true,purified:true,mega:true,mega_level:2,dynamax:true,gigantamax:true};
  assert.equal(ctx.filterPoke(pokemon),true);
  assert.equal(ctx.filterPoke({...pokemon,purified:false}),false);
  assert.equal(ctx.filterPoke({...pokemon,shiny:false}),false);
  assert.equal(ctx.filterPoke({...pokemon,name:'Lucario'}),false);
  const badges=ctx.statusBadges(pokemon);
  for(const label of ['Dmax','Gmax','Purified','Mega level 2'])assert.ok(badges.includes(label));
  assert.match(ctx.statusBadges({mega:true}),/Mega history/);
  assert.match(ctx.statusBadges({mega:true,mega_active:true}),/Mega active/);
});

test('game status and navigation icons use verified PokeMiners files',async()=>{
  const {ctx}=await assets();
  for(const [key,file] of Object.entries({shiny:'ic_shiny_white.png',shadow:'ic_shadow_filter.png',lucky:'ic_lucky_icon.png',purified:'ic_purified_filter.png',pvp:'btn_battle.png',raid:'ActivityLogRaidLogo.png',develop:'ic_evolvable.png',team1:'team_blue.png'}))assert.ok(ctx.gameStatusIcon(key).includes(file));
  assert.match(ctx.gameStatusIcon('gigantamax'),/status-gigantamax/);
});

test('analytics counts all overlapping tags in the full collection and Hatched filters combine',()=>{
  const app=source('app.js');
  const start=app.indexOf('const collectionTags=');
  const end=app.indexOf('function renderBoxTagStats',start);
  const ctx={S:{search:'',filter:'hatched',statusFilters:['purified']}};
  const filterStart=app.indexOf('function filterPoke(');
  vm.runInNewContext(app.slice(start,end)+app.slice(filterStart,app.indexOf('\n}',filterStart)+2),ctx);
  const rows=[{hatched:true,purified:true,shiny:true,mega:true,fav:true,event_tags:['Event'],iv_a:0,iv_d:0,iv_s:0},
    {dynamax:true,gigantamax:true,lucky:true,hundo:true,iv_a:15,iv_d:15,iv_s:15},{}];
  const counts=ctx.collectionTagCounts(rows);
  for(const key of ['hatched','purified','shiny','mega','fav','event','nando','dynamax','gigantamax','lucky','hundo'])assert.equal(counts[key],1,key);
  assert.equal(counts.shadow,0);
  assert.equal(ctx.filterPoke(rows[0]),true);
  assert.equal(ctx.filterPoke(rows[1]),false);
  const sidebar=fs.readFileSync(path.join(root,'templates/partials/sidebar.html'),'utf8');
  assert.doesNotMatch(sidebar,/stats-bar|stat-chip/);
});

test('living dex filters separate owned, missing, unknown, and unlisted forms',()=>{
  const script=source('pokedex-ui.js');
  const ctx={};
  vm.runInNewContext(script.slice(0,script.indexOf('\n(() =>')),ctx);
  const rows=[{pid:6,species_name:'Charizard',states:{all:'owned',xxl:'unknown',mega:'owned'}},
    {pid:25,species_name:'Pikachu',states:{all:'missing',xxl:'missing',mega:'not_catalogued'}}];
  assert.equal(ctx.filterDexRows(rows,'all','owned','').length,1);
  assert.equal(ctx.filterDexRows(rows,'all','missing','').length,1);
  assert.equal(ctx.filterDexRows(rows,'xxl','missing','').length,1);
  assert.equal(ctx.filterDexRows(rows,'xxl','unknown','').length,1);
  assert.equal(ctx.filterDexRows(rows,'mega','all','').length,1);
  assert.equal(ctx.filterDexRows(rows,'all','all','#0006')[0].pid,6);
  assert.equal(ctx.filterDexRows(rows,'all','all','pika')[0].pid,25);
});


test('history graphs use chronological timestamps and handle negative, single and empty data',()=>{
  const script=source('history-ui.js');
  const charts={innerHTML:''};
  const ctx={report:{period:'day',records:[{period:'2026-01-01',xp:0,stardust:-10,acquired:1},{period:'2026-01-02',xp:10,stardust:20,acquired:2},{period:'2026-01-10',xp:20,stardust:0,acquired:1}]},el:()=>charts,escapeHtml:String,number:String,stamp:String};
  vm.runInNewContext(script.slice(script.indexOf('  function renderCharts()'),script.indexOf('  function render()')),ctx);
  ctx.renderCharts();
  assert.equal((charts.innerHTML.match(/<polyline/g)||[]).length,3);
  const points=charts.innerHTML.match(/points="([^"]+)"/)[1].split(' ').map(x=>Number(x.split(',')[0]));
  assert.ok(points[1]-points[0]<(points[2]-points[1])/2,'Irregular time intervals retain their spacing');
  assert.ok(charts.innerHTML.includes('-10'));
  for(const records of [[],[{period:'2026-01-01',xp:0}]]){ctx.report.records=records;ctx.renderCharts();assert.doesNotMatch(charts.innerHTML,/NaN|Infinity/);}
  ctx.report.period='week';ctx.report.records=[{period:'2026-W01',xp:1},{period:'2026-W03',xp:2}];ctx.renderCharts();assert.doesNotMatch(charts.innerHTML,/NaN|Infinity/);
});
