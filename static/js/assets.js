/* Local artwork or verified PokeMiners paths. No game-image downloads or proxy. */
(() => {
  const remoteRoot='https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/';
  let catalog={mode:'local-first',files:{},overrides:{},count:0,issues:[]};
  const slug=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const normalize=value=>String(value||'').replace(/♀/g,'female').replace(/♂/g,'male').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  function remoteCandidates(kind,name,shiny,meta) {
    const index=window.PokeMinersAssets;
    if(!index)return [];
    const paths=[];
    if(kind==='pokemon') {
      const species=String(meta.species_name||name||'').split(' (')[0];
      const id=meta.pid ?? meta.species ?? index.names[normalize(species)];
      if(!id)return [];
      let form=normalize(meta.form||meta.form_slug||String(name||'').match(/\(([^)]+)\)/)?.[1]);
      const speciesKey=normalize(species);
      if(form.startsWith(speciesKey))form=form.slice(speciesKey.length);
      if(['normal','unset'].includes(form))form='';
      const forms=[...(meta.gigantamax?['gigantamax']:[]),form,''];
      for(const variant of (shiny?[':shiny','']:[''])) {
        for(const token of forms)paths.push(index.pokemon[id+':'+token+variant]);
      }
    } else if(kind==='item') {
      paths.push(index.items[String(meta.id)],index.itemNames[normalize(name)]);
    }
    return [...new Set(paths.filter(Boolean))].map(path=>remoteRoot+path.split('/').map(encodeURIComponent).join('/'));
  }
  function candidates(kind,name,shiny,meta={}) {
    const id=String(meta.pid ?? meta.id ?? '');
    const form=meta.form_slug || slug(meta.form);
    const suffix=shiny?':shiny':'';
    const keys=[kind+':'+id+(form?':'+form:'')+suffix,kind+':'+id+suffix,kind+':'+name+suffix];
    const paths=[];
    if(kind==='pokemon') {
      const ids=id?[id.padStart(4,'0'),id]:[];
      if(form) ids.forEach(n=>paths.push('pokemon/forms/'+n+'-'+form+(shiny?'-shiny':'')));
      ids.forEach(n=>paths.push('pokemon/'+(shiny?'shiny':'normal')+'/'+n));
      paths.push('pokemon/'+(shiny?'shiny':'normal')+'/'+slug(name));
      if(shiny) ids.forEach(n=>paths.push('pokemon/normal/'+n));
    } else paths.push(kind+'s/'+id,kind+'s/'+slug(name));
    const local=keys.map(k=>catalog.overrides[k]).filter(Boolean);
    for(const path of paths) for(const ext of ['png','webp','jpg','jpeg','gif','svg']) {
      if(catalog.files[path+'.'+ext]) local.push(catalog.files[path+'.'+ext]);
    }
    const remote=catalog.mode==='local-only'?[]:remoteCandidates(kind,name,shiny,meta);
    return [...new Set(catalog.mode==='local-only'?local:catalog.mode==='pokeminers'?remote:[...local,...remote])];
  }
  window.gameAsset=(kind,name,shiny=false,meta={})=>{
    const urls=candidates(kind,name,shiny,meta);
    const custom=catalog.overrides['icon:image-off-outline'] || catalog.files['icons/missing.svg'];
    const fallback=mdiIcon('image-off-outline')+(custom?'<img class="custom-fallback" src="'+escapeHtml(custom)+'" alt="">':'');
    return '<span class="game-art" title="'+escapeHtml(name)+'">'+fallback+
      (urls.length?'<img class="remote-game-art" src="'+escapeHtml(urls[0])+'" data-sources="'+escapeHtml(JSON.stringify(urls))+'" data-source-index="0" alt="'+escapeHtml(name)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+'</span>';
  };
  document.addEventListener('error',event=>{
    const img=event.target;
    if(img.matches?.('.local-ui-icon')){img.parentElement.classList.remove('has-custom-icon');img.remove();return;}
    if(img.matches?.('.custom-fallback')){img.remove();return;}
    if(!img.matches?.('.remote-game-art'))return;
    let sources=[];try{sources=JSON.parse(img.dataset.sources||'[]');}catch{}
    const index=Number(img.dataset.sourceIndex||0)+1;
    if(index<sources.length){img.dataset.sourceIndex=String(index);img.src=sources[index];return;}
    img.parentElement.classList.add('art-unavailable');
    img.parentElement.title='Image unavailable. Add a local image or select another source in Settings.';
    img.remove();
  },true);
  async function refresh() {
    try {
      const response=await fetch('/api/assets/catalog');
      if(!response.ok) throw Error('Unable to load asset catalog');
      catalog=await response.json();
      document.querySelectorAll('[data-user-icon]').forEach(shell=>{
        shell.querySelector('.local-ui-icon')?.remove();shell.classList.remove('has-custom-icon');
        const name=shell.dataset.userIcon,custom=catalog.overrides['icon:'+name]||catalog.files['icons/'+name+'.svg']||catalog.files['icons/'+name+'.png'];
        if(custom){const img=document.createElement('img');img.className='local-ui-icon';img.src=custom;img.alt='';shell.appendChild(img);shell.classList.add('has-custom-icon');}
      });
      document.querySelectorAll('[data-asset-mode]').forEach(el=>el.value=catalog.mode);
      const status=document.querySelector('[data-asset-status]');
      if(status)status.textContent=catalog.count+' local images found.'+(catalog.issues.length?' '+catalog.issues.join(' '):'');
    }catch(error){const status=document.querySelector('[data-asset-status]');if(status)status.textContent=error.message;}
    return catalog;
  }
  window.AssetLibrary={refresh,candidates,current:()=>catalog};
  window.assetReady=refresh();
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('[data-refresh-assets]')?.addEventListener('click',async()=>{await refresh();window.dispatchEvent(new Event('assetschange'));});
    document.querySelector('[data-asset-mode]')?.addEventListener('change',async event=>{
      const control=event.target,previous=catalog.mode;control.disabled=true;
      try{
        const response=await fetch('/api/assets/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:control.value})});
        if(!response.ok)throw Error('Unable to save image preferences');
        catalog.mode=control.value;window.dispatchEvent(new Event('assetschange'));
      }catch(error){control.value=previous;document.querySelector('[data-asset-status]').textContent=error.message;}
      finally{control.disabled=false;}
    });
  });
})();
