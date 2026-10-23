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
async function assets(catalog={mode:'local-first',files:{},overrides:{},count:0,issues:[]}) {
  const events={};
  const ctx={POGO_MDI:JSON.parse(fs.readFileSync(path.join(root,'static/mdi-icons.json'),'utf8')),
    Event:class {constructor(type){this.type=type;}},
    document:{addEventListener(name,fn){events[name]=fn;},querySelectorAll(){return [];},querySelector(){return null;}},
    fetch:async()=>({ok:true,json:async()=>catalog})};
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
test('local catalog picks Pokédex IDs and local-only mode never references remote artwork',async()=>{
  const {ctx}=await assets({mode:'local-only',files:{'pokemon/shiny/0025.webp':'/local-assets/pokemon/shiny/0025.webp'},overrides:{},count:1,issues:[]});
  const html=ctx.gameAsset('pokemon','Pikachu',true,{pid:25});
  assert.match(html,/src="\/local-assets\/pokemon\/shiny\/0025.webp/);
  assert.doesNotMatch(html,/https:/);
  assert.doesNotMatch(ctx.gameAsset('item','Potion',false,{id:101}),/remote-game-art/);
});
test('all browser scripts parse and language toggles have been removed',()=>{
  for(const name of fs.readdirSync(path.join(root,'static/js'))){
    new vm.Script(source(name),{filename:name});
  }
  assert.doesNotMatch(source('app.js'),/_lang|applyLanguage|pogo_lang|pokemondb.net/);
});

test('PokeMiners resolves named forms, shiny sprites, item IDs, and name-only callers',async()=>{
  const {ctx}=await assets({mode:'pokeminers',files:{'pokemon/normal/0025.png':'/local-assets/test.png'},overrides:{},count:1,issues:[]});
  assert.match(ctx.gameAsset('pokemon','Lapras',false,{pid:131,form:'LaprasNormal',gigantamax:true}),/pm131.fGIGANTAMAX.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Charizard',true,{pid:6,form:'CharizardMegaX'}),/pm6.fMEGA_X.s.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Zacian',false,{pid:888,form:'ZacianCrownedSword'}),/pm888.fCROWNED_SWORD.icon.png/);
  assert.match(ctx.gameAsset('pokemon','Nidoran♀'),/pm29.icon.png|pokemon_icon_029_00.png/);
  assert.match(ctx.gameAsset('item','Potion',false,{id:101}),/Items\/Item_0101.png/);
  assert.doesNotMatch(ctx.gameAsset('pokemon','Pikachu'),/local-assets/);
  assert.doesNotMatch(ctx.gameAsset('pokemon','Unknown species',true,{pid:999999}),/remote-game-art/);
  assert.doesNotMatch(ctx.gameAsset('item','Unknown item',false,{id:999999}),/remote-game-art/);
});

test('local artwork precedes PokeMiners and missing images advance through candidates',async()=>{
  const {ctx,events}=await assets({mode:'local-first',files:{'pokemon/normal/0025.png':'/local-assets/test.png'},overrides:{},count:1,issues:[]});
  const candidates=ctx.AssetLibrary.candidates('pokemon','Pikachu',false,{pid:25});
  assert.equal(candidates[0],'/local-assets/test.png');
  assert.match(candidates[1],/raw.githubusercontent.com\/PokeMiners/);
  const image={matches:selector=>selector==='.remote-game-art',dataset:{sources:JSON.stringify(candidates),sourceIndex:'0'}};
  events.error({target:image});
  assert.equal(image.src,candidates[1]);
});

test('status filters combine with search and shiny filter, and badges keep coexisting tags',()=>{
  const app=source('app.js');
  const ctx={S:{search:'latios',filter:'shiny',statusFilters:['purified','mega']},escapeHtml:value=>String(value)};
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
