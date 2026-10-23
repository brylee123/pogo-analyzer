/* Pictogrammers MDI, inline SVG paths; works without an icon webfont. */
(() => {
  window.mdiIcon = (name) => {
    const paths = window.POGO_MDI || {};
    name=paths[name]?name:'information-outline';
    return '<span class="mdi-shell"><svg class="mdi-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+(paths[name] || paths['information-outline'] || '')+'"/></svg></span>';
  };
  window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
})();
