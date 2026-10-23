/* Verified PokeMiners paths; direct image references with graceful fallback. */
(() => {
  const remoteRoot='https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/';
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
      paths.push(index.items[String(meta.id)],index.itemNames?.[normalize(name)]);
    } else if(kind==='status') {
      paths.push(index.icons?.[name]);
    }
    return [...new Set(paths.filter(Boolean))].map(path=>remoteRoot+path.split('/').map(encodeURIComponent).join('/'));
  }
  const candidates=(kind,name,shiny,meta={})=>remoteCandidates(kind,name,shiny,meta);
  window.gameAsset=(kind,name,shiny=false,meta={})=>{
    const urls=candidates(kind,name,shiny,meta);
    const tinted=kind==='status'&&['fav','shiny','purified','shadow','lucky','develop'].includes(name);
    const glyph=tinted&&urls.length?'<span class="status-glyph" style="--status-image:'+escapeHtml('url("'+urls[0]+'")')+'"></span>':'';
    const fallback={background:'image-outline',nando:'close',dynamax:'dna',gigantamax:'dna',fav:'star'};
    return '<span class="game-art'+(kind==='status'?' game-status-icon status-'+escapeHtml(name):'')+'"'+(kind==='status'?' aria-hidden="true"':'')+' title="'+escapeHtml(name)+'">'+mdiIcon(kind==='status'?(fallback[name]||'information-outline'):'image-off-outline')+
      (urls.length?'<img class="remote-game-art" src="'+escapeHtml(urls[0])+'" data-sources="'+escapeHtml(JSON.stringify(urls))+'" data-source-index="0" alt="'+escapeHtml(name)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+glyph+'</span>';
  };
  window.gameStatusIcon=name=>window.gameAsset('status',name);
  function hydrateStatusIcons(){document.querySelectorAll('[data-status-icon]').forEach(el=>el.innerHTML=gameStatusIcon(el.dataset.statusIcon));}
  document.addEventListener('error',event=>{
    const img=event.target;if(!img.matches?.('.remote-game-art'))return;
    let sources=[];try{sources=JSON.parse(img.dataset.sources||'[]');}catch{}
    const index=Number(img.dataset.sourceIndex||0)+1;
    if(index<sources.length){img.dataset.sourceIndex=String(index);img.src=sources[index];img.parentElement?.querySelector?.('.status-glyph')?.style.setProperty('--status-image','url("'+sources[index]+'")');return;}
    img.parentElement.classList.add('art-unavailable');img.parentElement.title='PokeMiners image unavailable';img.parentElement?.querySelector?.('.status-glyph')?.remove();img.remove();
  },true);
  window.AssetLibrary={candidates};
  window.assetReady=Promise.resolve();
  document.addEventListener('DOMContentLoaded',hydrateStatusIcons);
})();
