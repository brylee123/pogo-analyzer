/* Remote image references only. No fetch, proxy, blob, file download or asset cache. */
(() => {
  const wiki = 'https://pokemongo.fandom.com/wiki/';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const aliases = {'Poke Ball':'Poké Ball','Pokeball':'Poké Ball','Nidoran-F':'Nidoran♀','Nidoran-M':'Nidoran♂','Ho-Oh':'Ho-Oh',"Farfetchd":"Farfetch'd",'Mr. Mime':'Mr. Mime'};
  window.gameAsset = (kind, name, shiny=false) => {
    const title = aliases[name] || String(name || '').trim();
    if(!title || title.startsWith('#')) return '<span class="game-art fallback-only" aria-hidden="true">◇</span>';
    const file = title + (shiny && kind === 'pokemon' ? ' shiny' : '') + '.png';
    const href = wiki + encodeURIComponent(title.replaceAll(' ','_'));
    const src = wiki + 'Special:FilePath/' + encodeURIComponent(file.replaceAll(' ','_'));
    return '<a class="game-art" href="'+href+'" target="_blank" rel="noopener noreferrer" aria-label="'+escape(title)+' on Pokémon GO Wiki">'
      +'<span class="art-fallback" aria-hidden="true">'+(kind==='item'?'◆':'◇')+'</span>'
      +'<img class="remote-game-art" src="'+src+'" alt="'+escape(title)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>';
  };
  document.addEventListener('error', event => {
    if(event.target.matches?.('.remote-game-art')) {
      event.target.parentElement.classList.add('art-unavailable');
      event.target.remove();
    }
  }, true);
})();
