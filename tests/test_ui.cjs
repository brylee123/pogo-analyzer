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
  vm.createContext(ctx);vm.runInContext(source('mdi.js'),ctx);vm.runInContext(source('assets.js'),ctx);
  await ctx.assetReady;
  return {ctx,events};
}
test('remote references escape attributes and fall back to an MDI icon without image downloads',async()=>{
  const {ctx,events}=await assets();
  const html=ctx.gameAsset('item','Poké Ball');
  assert.match(html,/https:\/\/pokemongo.fandom.com\/wiki\/Special:FilePath\/Pok%C3%A9_Ball.png/);
  assert.match(ctx.gameAsset('pokemon','Pikachu',true,{pid:25}),/Pikachu_shiny.png/);
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
