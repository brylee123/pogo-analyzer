(() => {
  const el=id=>document.getElementById(id);
  let report=null,page=0,detail=null,detailPage=0,requestId=0;
  const size=40;
  const number=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
  const stamp=value=>value?new Date(value).toISOString().replace('T',' ').replace('.000Z',' UTC'):'Not available';
  async function json(url,options={}) {
    const response=await fetch(url,options),data=await response.json();
    if(!response.ok)throw Error(data.error||'Unable to load history');
    return data;
  }
  async function load() {
    const id=++requestId;
    el('history-status').textContent='Loading history…';
    try {
      await window.assetReady;
      const query=new URLSearchParams({period:el('history-period').value});
      for(const key of ['account','start','end']) if(el('history-'+key).value)query.set(key,el('history-'+key).value);
      const data=await json('/api/history/report?'+query);
      if(id!==requestId)return;
      report=data;page=0;
      el('history-account').innerHTML=data.accounts.map(account=>'<option value="'+escapeHtml(account.account)+'">'+escapeHtml(account.account)+' ('+account.snapshots+' exports)</option>').join('');
      if(data.account)el('history-account').value=data.account;
      el('history-status').textContent=data.snapshots
        ? data.snapshots+' exports · baseline '+stamp(data.baseline)+' · latest '+stamp(data.latest)+' · '+data.session_count+' sessions in this range. '+data.attribution
        : 'No assigned history yet. Add the current export or import earlier full exports. Re-verify your trainer if older history is unassigned. The first export is a baseline; at least two exports are needed for a comparison.';
      if(data.snapshots===1)el('history-status').textContent+=' One export is a baseline; import another export to create a session.';
      el('history-legacy').hidden=!data.unassigned_snapshots;
      el('history-legacy-message').textContent=data.unassigned_snapshots+' preserved exports match trainers linked to your profile.';
      const metrics={caught:'Caught',acquired:'Acquired',removed:'Removed',shinies:'New shiny',hundos:'New hundo',xp:'XP gained',stardust:'Stardust net',coins:'Coins net',distance_km:'Distance km'};
      el('history-metrics').innerHTML=Object.entries(metrics).map(([key,label])=>'<div class="metric-tile"><span>'+label+'</span><strong>'+number(data.totals[key])+'</strong></div>').join('');
      render();
    }catch(error){if(id===requestId)el('history-status').textContent=error.message;}
  }
  function render() {
    const records=[...(report?.records||[])].reverse(),pages=Math.max(1,Math.ceil(records.length/size));
    page=Math.min(page,pages-1);
    el('history-tbody').innerHTML=records.slice(page*size,(page+1)*size).map(row=>'<tr><td>'+escapeHtml(report.period==='session'?stamp(row.start)+' to '+stamp(row.end):row.period)+'</td><td>'+row.sessions+'</td>'+['caught','acquired','removed','shinies','hundos','xp','stardust','coins','distance_km','items_gained','items_spent'].map(key=>'<td class="mono">'+number(row[key])+'</td>').join('')+'<td>'+(row.id?'<button class="btn btn-outline btn-sm" data-session-id="'+row.id+'">View session</button>':'Select individual sessions for details')+'</td></tr>').join('')||'<tr><td colspan="14">No sessions in the selected range.</td></tr>';
    el('history-page').textContent='Page '+(page+1)+' of '+pages+' · '+records.length+' rows';
    el('history-prev').disabled=page===0;el('history-next').disabled=page>=pages-1;
  }
  async function openDetail(id) {
    el('history-detail').hidden=false;el('history-detail-title').textContent='Loading session…';
    try {
      detail=await json('/api/history/sessions/'+id);detailPage=0;
      el('history-detail-title').textContent=detail.account+' · Session #'+detail.id;
      el('history-detail-summary').textContent=stamp(detail.start)+' to '+stamp(detail.end)+'. Removed means absent from the next export; it does not prove transfer.';
      const other=detail.changes;
      el('history-detail-other').innerHTML='<h3>Item and counter deltas</h3><div class="tbl-wrap"><table><thead><tr><th>Item ID</th><th>Name</th><th>Net change</th></tr></thead><tbody>'+(other.item_details||[]).map(item=>'<tr><td>'+escapeHtml(item.id)+'</td><td>'+escapeHtml(item.name)+'</td><td>'+number(item.delta)+'</td></tr>').join('')+'</tbody></table></div><h3>Currencies</h3><pre>'+escapeHtml(JSON.stringify(other.currencies||{},null,2))+'</pre><h3>Player-stat changes</h3><pre>'+escapeHtml(JSON.stringify(other.stats||{},null,2))+'</pre>';
      renderDetail();el('history-detail').scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){el('history-detail-title').textContent=error.message;}
  }
  function renderDetail() {
    if(!detail)return;
    const kind=el('history-change-kind').value,search=el('history-detail-search').value.trim().toLowerCase();
    const rows=(detail.changes[kind]||[]).map(value=>kind==='modified'?{...value.pokemon,before:value.before}:value).filter(p=>[p.name,p.nickname,p.pid].join(' ').toLowerCase().includes(search));
    const pages=Math.max(1,Math.ceil(rows.length/size));detailPage=Math.min(detailPage,pages-1);
    el('history-detail-tbody').innerHTML=rows.slice(detailPage*size,(detailPage+1)*size).map(p=>'<tr><td class="mono">#'+String(p.pid).padStart(4,'0')+'</td><td>'+gameAsset('pokemon',p.name,p.shiny,p)+escapeHtml(p.name)+'</td><td>'+escapeHtml(p.nickname||'No nickname')+'</td><td>'+escapeHtml(p.before?p.before.cp+' to '+p.cp:p.cp)+'</td><td>'+escapeHtml(p.before?p.before.iv_pct+'% to '+p.iv_pct+'%':p.iv_pct+'%')+'</td><td>'+escapeHtml(p.lvl??'Not reported')+'</td></tr>').join('')||'<tr><td colspan="6">No matching Pokémon changes.</td></tr>';
    el('history-detail-page').textContent='Page '+(detailPage+1)+' of '+pages+' · '+rows.length+' changes';
    el('history-detail-prev').disabled=detailPage===0;el('history-detail-next').disabled=detailPage>=pages-1;
  }
  async function post(url,body) {
    const target=el('history-import-result');target.textContent='Working…';
    try {
      const result=await json(url,{method:'POST',...(body?{body}:{headers:{'Content-Type':'application/json'},body:'{}'})});
      target.textContent=result.results?result.results.map(row=>row.filename+': '+(row.error||row.status)).join('\n'):(result.status||'Completed');
      await load();
    }catch(error){target.textContent=error.message;}
  }
  el('history-filter-form').addEventListener('submit',event=>{event.preventDefault();load();});
  el('history-refresh').addEventListener('click',load);
  el('history-all-dates').addEventListener('click',()=>{el('history-start').value='';el('history-end').value='';load();});
  el('history-account').addEventListener('change',load);el('history-period').addEventListener('change',load);
  el('history-prev').addEventListener('click',()=>{page--;render();});el('history-next').addEventListener('click',()=>{page++;render();});
  el('history-tbody').addEventListener('click',event=>{const button=event.target.closest('[data-session-id]');if(button)openDetail(button.dataset.sessionId);});
  el('history-detail-close').addEventListener('click',()=>el('history-detail').hidden=true);
  for(const id of ['history-change-kind','history-detail-search'])el(id).addEventListener(id.endsWith('search')?'input':'change',()=>{detailPage=0;renderDetail();});
  el('history-detail-prev').addEventListener('click',()=>{detailPage--;renderDetail();});el('history-detail-next').addEventListener('click',()=>{detailPage++;renderDetail();});
  el('history-import').addEventListener('click',()=>{const data=new FormData();for(const file of el('history-files').files)data.append('files',file);if(!el('history-files').files.length){el('history-import-result').textContent='Choose export files first.';return;}post('/api/history/upload',data);});
  el('history-import-current').addEventListener('click',()=>post('/api/history/import-current'));
  el('history-restore').addEventListener('click',()=>post('/api/history/restore-legacy'));
  window.addEventListener('panelchange',event=>{if(event.detail==='history')load();});
})();
