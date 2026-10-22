/* Runs in the head before paint. Preferences come from the signed-in profile. */
(() => {
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let prefs = {theme: 'system', accent: 'auto', team: 'mystic', ...window.POGO_APPEARANCE};
  const validTeams = ['mystic', 'valor', 'instinct'];
  function apply() {
    root.dataset.theme = prefs.theme === 'system' ? (system.matches ? 'dark' : 'light') : prefs.theme;
    root.dataset.accent = validTeams.includes(prefs.accent) ? prefs.accent : (validTeams.includes(prefs.team) ? prefs.team : 'mystic');
    root.style.colorScheme = root.dataset.theme;
    document.querySelectorAll('[data-appearance-theme]').forEach(el => el.value = prefs.theme);
    document.querySelectorAll('[data-appearance-accent]').forEach(el => el.value = prefs.accent);
    document.querySelectorAll('[data-team-description]').forEach(el => {
      el.textContent = 'Automatic: Team ' + prefs.team[0].toUpperCase() + prefs.team.slice(1);
    });
    window.dispatchEvent(new CustomEvent('appearancechange'));
  }
  system.addEventListener('change', apply);
  apply();
  window.PogoAppearance = {
    updateTeam(team) {prefs.team = ({1:'mystic',2:'valor',3:'instinct'})[Number(team)] || 'mystic'; apply();},
    current() {return {...prefs};}
  };
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-appearance-theme],[data-appearance-accent]').forEach(control => {
      control.addEventListener('change', async () => {
        const before = {...prefs};
        const status = document.querySelector('[data-appearance-status]');
        if(control.matches('[data-appearance-theme]')) prefs.theme=control.value;
        else prefs.accent=control.value;
        apply();
        const controls = document.querySelectorAll('[data-appearance-theme],[data-appearance-accent]');
        controls.forEach(el=>el.disabled=true);
        if(status) status.textContent='Saving…';
        try {
          const response = await fetch('/api/appearance', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:prefs.theme,accent:prefs.accent})});
          const data = await response.json();
          if(!response.ok) throw Error(data.error || 'Unable to save appearance');
          prefs=data; apply();
          if(status) status.textContent='Appearance saved to your profile.';
        } catch(error) {
          prefs=before; apply();
          if(status) status.textContent=error.message;
        } finally {controls.forEach(el=>el.disabled=false);}
      });
    });
  });
})();
