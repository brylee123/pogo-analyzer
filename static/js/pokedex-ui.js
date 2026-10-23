function filterDexRows(rows,category,status,search) {
  const query=search.trim().toLowerCase().replace(/^#/,'');
  return rows.filter(row=>row.states[category]!=='not_catalogued'
    &&(status==='all'||row.states[category]===status)
    &&(!query||row.species_name.toLowerCase().includes(query)||String(row.pid).includes(query)||String(row.pid).padStart(4,'0').includes(query)));
}

(() => {
  const el=id=>document.getElementById(id);
  let data=null,category='all',status='all',query='',page=0,dirty=true,serial=0;
  const pageSize=40;
  const icon=key=>gameStatusIcon(key==='all'?'total':key);
  function render() {
    if(!data)return;
    const summary=data.summary[category];
    el('dex-category-title').textContent=data.categories[category];
    el('dex-progress-text').textContent=summary.owned.toLocaleString('en-US')+' / '+summary.total.toLocaleString('en-US')+' owned';
    el('dex-progress-detail').textContent=summary.missing.toLocaleString('en-US')+' missing'+(summary.unknown?' · '+summary.unknown.toLocaleString('en-US')+' unknown':'');
    el('dex-progress').max=summary.total||1;el('dex-progress').value=summary.owned;
    el('dex-categories').innerHTML=Object.entries(data.categories).map(([key,label])=>{
      const item=data.summary[key];
      return '<button type="button" class="metric-tile dex-category '+(key===category?'selected':'')+'" data-dex-category="'+key+'" aria-pressed="'+(key===category)+'">'
        +'<span>'+icon(key)+escapeHtml(label)+'</span><strong>'+item.owned+' <small>/ '+item.total+'</small></strong></button>';
    }).join('');
    el('dex-category').value=category;
    const rows=filterDexRows(data.rows,category,status,query),pages=Math.max(1,Math.ceil(rows.length/pageSize));
    page=Math.max(0,Math.min(page,pages-1));
    el('dex-status').textContent=!data.loaded?'Upload a current export to compare your living dex. Ownership is unknown until a collection is loaded.':rows.length.toLocaleString('en-US')+' matching species · counts use your current collection';
    el('dex-head').innerHTML='<tr><th scope="col" class="dex-species-heading">Pokémon</th>'+Object.entries(data.categories).map(([key,label])=>'<th scope="col" class="'+(key===category?'dex-selected-column':'')+'">'+icon(key)+'<span>'+escapeHtml(label)+'</span></th>').join('')+'</tr>';
    el('dex-body').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(row=>{
      const forms=row.forms.map(form=>'<li>'+escapeHtml(form.name)+' <b>×'+form.count+'</b></li>').join('');
      const name='<span class="mono supporting-text">#'+String(row.pid).padStart(4,'0')+'</span><strong>'+escapeHtml(row.species_name)+'</strong>';
      const identity=forms?'<details><summary>'+name+'</summary><ul class="dex-held-forms">'+forms+'</ul></details>':'<div class="dex-name">'+name+'</div>';
      const image=gameAsset('pokemon',row.species_name,category==='shiny',{pid:row.pid,gigantamax:category==='gigantamax'});
      return '<tr><th scope="row" class="dex-species"><div class="dex-species-content '+(row.counts.all?'':'dex-unowned')+'">'+image+identity+'</div></th>'
        +Object.keys(data.categories).map(key=>{
          const state=row.states[key],count=row.counts[key];
          const text=state==='owned'?'Owned ×'+count:state==='missing'?'Missing':state==='unknown'?'Unknown':'—';
          return '<td class="dex-cell-status dex-'+state+(key===category?' dex-selected-column':'')+'" title="'+(state==='not_catalogued'?'No catalogued form':text)+'">'+(state==='owned'?mdiIcon('check'):'')+'<span>'+text+'</span></td>';
        }).join('')+'</tr>';
    }).join('')||'<tr><td colspan="'+(Object.keys(data.categories).length+1)+'">No species match these filters.</td></tr>';
    el('dex-page').textContent='Page '+(page+1)+' of '+pages;
    el('dex-prev').disabled=page===0;el('dex-next').disabled=page+1>=pages;
  }
  async function load() {
    const request=++serial;el('dex-status').textContent='Loading your living dex…';
    try {
      const result=await api('/api/pokedex');
      if(request!==serial)return;
      result.categories=Object.fromEntries((result.category_order||Object.keys(result.categories)).map(key=>[key,result.categories[key]]));
      data=result;dirty=false;
      el('dex-category').innerHTML=Object.entries(data.categories).map(([key,label])=>'<option value="'+key+'">'+escapeHtml(label)+'</option>').join('');
      render();
    }catch(error){if(request===serial)el('dex-status').textContent=error.message;}
  }
  function choose(key){category=key;page=0;render();}
  el('dex-category').addEventListener('change',event=>choose(event.target.value));
  el('dex-categories').addEventListener('click',event=>{const button=event.target.closest('[data-dex-category]');if(button)choose(button.dataset.dexCategory);});
  el('dex-ownership').addEventListener('change',event=>{status=event.target.value;page=0;render();});
  el('dex-search').addEventListener('input',event=>{query=event.target.value;page=0;render();});
  el('dex-prev').addEventListener('click',()=>{page--;render();});
  el('dex-next').addEventListener('click',()=>{page++;render();});
  el('dex-refresh').addEventListener('click',load);
  window.addEventListener('panelchange',event=>{if(event.detail==='pokedex'){if(dirty)load();else render();}});
  window.addEventListener('collectionchange',()=>{dirty=true;if(el('panel-pokedex').classList.contains('active'))load();});
  window.addEventListener('assetschange',render);
})();
