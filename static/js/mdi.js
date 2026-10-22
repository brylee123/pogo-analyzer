/* Pictogrammers MDI, inline SVG paths; works without an icon webfont. */
(() => {
  window.mdiIcon = (name) => {
    const paths = window.POGO_MDI || {};
    name=paths[name]?name:'information-outline';
    const catalog=window.AssetLibrary?.current();
    const custom=catalog?.overrides?.['icon:'+name] || catalog?.files?.['icons/'+name+'.svg'] || catalog?.files?.['icons/'+name+'.png'];
    return '<span class="mdi-shell'+(custom?' has-custom-icon':'')+'" data-user-icon="'+name+'"><svg class="mdi-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+(paths[name] || paths['information-outline'] || '')+'"/></svg>'+(custom?'<img class="local-ui-icon" src="'+escapeHtml(custom)+'" alt="">':'')+'</span>';
  };
  window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
})();
