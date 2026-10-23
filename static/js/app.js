// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  pokemons: [],
  items:    [],
  player:   null,
  events:   [],
  tiers:    {},
  filter:   "all",
  statusFilters: [],
  search:   "",
  sort:     "cp",
};


// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(e.error || r.statusText);
  }
  return r.json();
}

function ivClass(iv) {
  if (iv === 100) return "iv-s";
  if (iv >= 82)   return "iv-a";
  if (iv >= 60)   return "iv-n";
  return "iv-l";
}

function tierBadge(tier) {
  if (!tier) return "";
  const parts = tier.split(" ");
  const tierVal = parts[parts.length - 1] || "";
  const firstChar = tierVal.charAt(0).toUpperCase();
  const cls = { S: "badge-s", A: "badge-a", B: "badge-b", C: "badge-c", D: "badge-d" }[firstChar] || "badge";
  return `<span class="badge ${cls}">${tier}</span>`;
}

function mdToHtml(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#{1,3} (.+)$/gm, (_, t) => `<h2>${t.replace(/\*\*/g,"")}</h2>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)+/g, m => `<ul>${m}</ul>`)
    .replace(/^(\d+\. .+)$/gm, "<li>$1</li>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^(.+)$/, "<p>$1</p>");
}


let hasLatestExport = false;
function dexLabel(p) { return '#' + String(p.pid ?? p.species ?? '?').padStart(4,'0'); }
function pokemonIdentity(p) {
  const species=p.species_name || p.name || 'Unknown species';
  const form=p.name && p.name!==species?p.name:'';
  return '<div class="pokemon-identity"><strong>'+escapeHtml(species)+'</strong>'
    +(form?'<span class="supporting-text">'+escapeHtml(form)+'</span>':'')
    +(p.nick?'<span class="pokemon-nickname">Nickname: '+escapeHtml(p.nick)+'</span>':'')+'</div>';
}
function statusBadges(p) {
  const flags={mega:p.mega_active?'Mega active':p.mega_level?'Mega level '+p.mega_level:'Mega history',dynamax:'Dmax',gigantamax:'Gmax',purified:'Purified',hatched:'Hatched',costumed:'Costumed'};
  return Object.entries(flags).filter(([key])=>p[key]).map(([key,label])=>key==='costumed'
    ?tagBadge(key,label)
    :'<button type="button" class="badge form-badge game-tag status-tag" data-status-tag="'+key+'" title="Filter Pokémon by '+key+'">'+gameStatusIcon(key)+escapeHtml(label)+'</button>').join('');
}
function tagBadge(key,label) {
  return '<span class="badge game-tag">'+gameStatusIcon(key)+escapeHtml(label)+'</span>';
}
const collectionTags={shiny:'Shiny',hundo:'Hundo',nando:'Nando',shadow:'Shadow',lucky:'Lucky',
  dynamax:'Dmax',gigantamax:'Gmax',purified:'Purified',mega:'Mega evolution / history',
  hatched:'Hatched',costumed:'Costumed',fav:'Favorite',event:'Event'};
function collectionTagCounts(pokemons) {
  return Object.fromEntries(Object.keys(collectionTags).map(key=>[key,pokemons.filter(p=>
    key==='nando'?p.iv_a===0&&p.iv_d===0&&p.iv_s===0:
    key==='event'?p.event_tags?.length>0:!!p[key]).length]));
}
function renderBoxTagStats() {
  const counts=collectionTagCounts(S.pokemons);
  const rows=[['total','Pokémon',S.pokemons.length],...Object.entries(collectionTags).map(([key,label])=>[key,label,counts[key]]),
    ['stardust','Stardust',S.player?.stardust??null]];
  $('box-tag-stats').innerHTML=rows.map(([key,label,count])=>'<div class="box-tag-stat">'
    +'<span>'+gameStatusIcon(key)+escapeHtml(label)+'</span><strong>'+(count===null?'—':Number(count).toLocaleString('en-US'))+'</strong></div>').join('');
}
function uploadHistoryNotice(result) {
  const target=$('upload-history-status');
  if(target && result?.history)target.textContent=result.history.message || (result.history.status==='duplicate'?'This export is already in history.':'Export recorded in History & sessions.');
}

// ── Upload ────────────────────────────────────────────────────────────────────
function setupUpload(input) {
  input.addEventListener("change", async () => {
    if (!input.files[0]) return;
    const fd = new FormData();
    fd.append("file", input.files[0]);
    try {
      const data = await fetch("/api/upload", { method: "POST", body: fd }).then(r => r.json());
      if (data.error) throw new Error(data.error);
      await onUploadSuccess(data.stats, data.player, data.pvp_stats);
      uploadHistoryNotice(data);
    } catch (e) {
      showErr(e.message);
    }
    input.value = "";
  });
}
setupUpload($("upload-input"));
setupUpload($("upload-input-small"));

const zone = $("upload-zone");
zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag"); });
zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
zone.addEventListener("drop", e => {
  e.preventDefault(); zone.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (file) {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/upload", { method: "POST", body: fd })
      .then(r => r.json())
      .then(async d => {if(d.error)showErr(d.error);else {await onUploadSuccess(d.stats,d.player,d.pvp_stats);uploadHistoryNotice(d);}})
      .catch(e => showErr(e.message));
  }
});

function showErr(msg) {
  const el = $("upload-err");
  el.textContent = "❌ " + msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

async function onUploadSuccess(stats, player, pvp_stats) {
  S.player=player||null;
  hasLatestExport=true;
  $("panel-pokemon").hidden=false;
  await window.assetReady;
  $("upload-zone").style.display   = "none";
  $("upload-err").style.display    = "none";
  $("main-ui").style.display       = "block";
  $("upload-small").style.display  = "block";
  $("tabs").style.display          = "flex";
  $("header-sub").textContent      = "Your Pokémon GO account";
  const hint = document.querySelector(".sidebar-hint");
  if (hint) hint.style.display = "none";

  $("tb-poke").textContent  = stats.total;

  // Handle Player Card in Sidebar
  window.PogoAppearance?.updateTeam(player?.team);
  if (player) {
    $("sidebar-player").style.display = "flex";
    $("s-player-name").textContent = player.name || "Trainer";
    $("s-player-level").textContent = `Lvl ${player.level || "?"} · ${player.kmWalked || 0} km`;
    
    const avatar = $("s-player-avatar");
    avatar.className = "";
    if (player.team === 1) {
      avatar.classList.add("team-mystic-bg");
      avatar.textContent = "❄️";
    } else if (player.team === 2) {
      avatar.classList.add("team-valor-bg");
      avatar.textContent = "🔥";
    } else if (player.team === 3) {
      avatar.classList.add("team-instinct-bg");
      avatar.textContent = "⚡";
    } else {
      avatar.textContent = "👤";
    }
  } else {
    $("sidebar-player").style.display = "none";
  }

  // Handle PvP Battle stats dashboard
  if (pvp_stats && pvp_stats.season_battles > 0) {
    $("pvp-stats-card").style.display = "block";
    $("pvp-stat-rank").textContent = pvp_stats.season_rank || "—";
    
    const winrate = pvp_stats.season_battles > 0 
      ? ((pvp_stats.season_wins / pvp_stats.season_battles) * 100).toFixed(1) + "%" 
      : "—";
    $("pvp-stat-winrate").textContent = winrate;
    $("pvp-stat-ratio").textContent = `${pvp_stats.season_wins} W / ${pvp_stats.season_battles} B`;
    $("pvp-stat-streak").textContent = pvp_stats.season_longest_streak || "—";
    $("pvp-stat-dust").textContent = pvp_stats.season_stardust ? pvp_stats.season_stardust.toLocaleString("en-US") : "—";
    
    const formatLeague = (wins, total) => {
      if (!total) return "—";
      const pct = ((wins / total) * 100).toFixed(0);
      return `${wins}/${total} (${pct}%)`;
    };
    $("pvp-stat-gl").textContent = formatLeague(pvp_stats.gl_wins, pvp_stats.gl_battles);
    $("pvp-stat-ul").textContent = formatLeague(pvp_stats.ul_wins, pvp_stats.ul_battles);
    $("pvp-stat-ml").textContent = formatLeague(pvp_stats.ml_wins, pvp_stats.ml_battles);
  } else {
    $("pvp-stats-card").style.display = "none";
  }

  await Promise.all([loadPokemons(), loadItems(), loadEvents(), loadTiers(), loadCacheStats(), loadConfig()]);
  loadRaid();
  loadPvP("GL");
  loadDevelop();
  loadPvpGems();
  updatePogoQuery();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach(b => b.classList.remove("active"));
    $$(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("panel-" + btn.dataset.tab).classList.add("active");
    $("upload-zone").style.display=btn.dataset.tab==='pokemon'&&!hasLatestExport?'flex':'none';
    window.dispatchEvent(new CustomEvent('panelchange',{detail:btn.dataset.tab}));
    if(btn.dataset.tab==='forms')renderForms();
  });
});

// ── Pokémon ──────────────────────────────────────────────────────────────────
async function loadPokemons() {
  S.pokemons = await api("/api/pokemons");
  renderPokemons();
  renderForms();
  updateAnalytics();
  window.dispatchEvent(new Event('collectionchange'));
}

$("poke-search").addEventListener("input", e => { S.search = e.target.value.toLowerCase(); renderPokemons(); });
$("poke-filter").addEventListener("change", e => { S.filter = e.target.value; renderPokemons(); });
$("poke-sort").addEventListener("change",   e => { S.sort   = e.target.value; renderPokemons(); });

function setStatusFilters(tags) {
  S.statusFilters=tags;
  $$('[data-status-filter]').forEach(control=>control.checked=tags.includes(control.dataset.statusFilter));
  renderPokemons();
}
$$('[data-status-filter]').forEach(control=>control.addEventListener('change',()=>{
  setStatusFilters([...$$('[data-status-filter]')].filter(el=>el.checked).map(el=>el.dataset.statusFilter));
}));
$('clear-status-filters').addEventListener('click',()=>setStatusFilters([]));
document.addEventListener('click',event=>{
  const tag=event.target.closest('[data-status-tag]');
  if(!tag)return;
  const key=tag.dataset.statusTag;
  setStatusFilters(S.statusFilters.includes(key)?S.statusFilters.filter(value=>value!==key):[...S.statusFilters,key]);
  document.querySelector('.tab[data-tab="pokemon"]').click();
});

function filterPoke(p) {
  if (S.statusFilters.some(key=>!p[key])) return false;
  if (S.search && ![p.name,p.species_name,p.nick,p.pid].join(' ').toLowerCase().includes(S.search.replace(/^#/,''))) return false;
  switch (S.filter) {
    case "mega": return !!p.mega;
    case "dynamax": return !!p.dynamax;
    case "gigantamax": return !!p.gigantamax;
    case "purified": return !!p.purified;
    case "hatched": return !!p.hatched;
    case "fav": return !!p.fav;
    case "nando": return p.iv_a===0&&p.iv_d===0&&p.iv_s===0;
    case "costumed": return !!p.costumed;
    case "hundo":   return p.hundo;
    case "shiny":   return p.shiny;
    case "shadow":  return p.shadow;
    case "lucky":   return p.lucky;
    case "tier_s":  return p.best_tier && p.best_tier.startsWith("S");
    case "tier_a":  return p.best_tier && p.best_tier.startsWith("A");
    case "trash": {
      const cpMin = parseInt($("ropt-cp-min").value) || 1200;
      const protectHundo = $("ropt-hundo").checked;
      const protectNando = $("ropt-nando").checked;
      const protectShiny = $("ropt-shiny").checked;
      const protectShadow = $("ropt-shadow").checked;
      const protectLucky = $("ropt-lucky").checked;
      const protectFav = $("ropt-fav").checked;
      const protectMeta = $("ropt-meta").checked;
      const protectIv = $("ropt-iv").checked;
      const protectPvp = $("ropt-pvp").checked;
      const protectLvl = $("ropt-lvl").checked;

      const isProtected = (protectHundo && (p.hundo || p.iv_pct === 100))
        || (protectNando && p.iv_pct === 0)
        || (protectShiny && p.shiny)
        || (protectShadow && p.shadow)
        || (protectLucky && p.lucky)
        || (protectFav && p.fav)
        || (protectMeta && p.best_tier && (p.best_tier.startsWith("S") || p.best_tier.startsWith("A")))
        || (protectIv && p.iv_pct >= 82.2)
        || (p.cp >= cpMin)
        || (protectPvp && p.gl_rank > 0 && p.gl_rank <= 500)
        || (protectLvl && p.lvl >= 35);
        
      return !isProtected;
    }
    case "y2016":   return p.year >= 2016 && p.year <= 2018;
    case "y2022":   return p.year >= 2019 && p.year <= 2022;
    case "pvp_gem": return p.gl_rank > 0 && p.gl_rank <= 250;
    default:        return true;
  }
}

function sortPokes(arr) {
  return [...arr].sort((a, b) => {
    if (S.sort === "iv")   return b.iv_pct - a.iv_pct;
    if (S.sort === "lvl")  return b.lvl - a.lvl;
    if (S.sort === "dex") return a.pid-b.pid;
    if (S.sort === "name") return a.name.localeCompare(b.name);
    return b.cp - a.cp;
  });
}

function renderPokemons() {
  const list = sortPokes(S.pokemons.filter(filterPoke));
  $("poke-count").textContent = `${list.length} / ${S.pokemons.length}`;
  const tbody = $("poke-tbody");
  tbody.innerHTML = list.map(p => {
    const tiers = p.tiers || {};
    const tierBadges = Object.entries(tiers)
      .map(([cat, t]) => `<span class="badge badge-${t.charAt(0).toLowerCase()}" data-tooltip="${cat}">${cat.split("_").pop().toUpperCase()} ${t}</span>`)
      .join("");
    const evTags = (p.event_tags || []).slice(0, 2)
      .map(ev => tagBadge('event',ev)).join("");
    const tags = [
      p.shiny  ? `${tagBadge('shiny','Shiny')}` : "",
      p.shadow ? `${tagBadge('shadow','Shadow')}` : "",
      p.hundo  ? `${tagBadge('hundo','Hundo')}` : "",
      p.lucky  ? `${tagBadge('lucky','Lucky')}` : "",
      p.fav ? tagBadge('fav','Favorite') : '',
      p.iv_a===0&&p.iv_d===0&&p.iv_s===0 ? tagBadge('nando','Nando') : '',
      statusBadges(p),
      evTags,
    ].join("");
    const yr = p.year <= 2018 ? "year-old" : p.year <= 2022 ? "year-mid" : "";
    return `<tr>
      <td class="dex-cell mono">${dexLabel(p)}</td><td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}
        ${pokemonIdentity(p)}
        ${p.move1_name ? `
        <div class="moves-row">
          <span class="move-tag type-${p.move1_type}" data-tooltip="Fast Move">${p.move1_name}</span>
          ${p.move2_name ? `<span class="move-tag type-${p.move2_type}" data-tooltip="Charged Move">${p.move2_name}</span>` : ''}
          ${p.move3_name ? `<span class="move-tag type-${p.move3_type}" data-tooltip="Second Charged Move">${p.move3_name}</span>` : ''}
        </div>` : ''}
      </td>
      <td class="cp-cell">${p.cp}</td>
      <td class="mono">${p.lvl}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td class="mono">${p.iv_a}/${p.iv_d}/${p.iv_s}</td>
      <td class="${yr}">${p.year || "—"}</td>
      <td>${tierBadges || '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td>${tags || '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${S.pokemons.indexOf(p)})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" style="padding:24px;text-align:center;color:var(--muted)">No results</td></tr>`;
}

function buildPogoQuery() {
  const cpMin = parseInt($("ropt-cp-min").value) || 1200;
  
  const protectHundo = $("ropt-hundo").checked;
  const protectNando = $("ropt-nando").checked;
  const protectShiny = $("ropt-shiny").checked;
  const protectShadow = $("ropt-shadow").checked;
  const protectLucky = $("ropt-lucky").checked;
  const protectFav = $("ropt-fav").checked;
  const protectMeta = $("ropt-meta").checked;
  const protectIv = $("ropt-iv").checked;
  const protectPvp = $("ropt-pvp").checked;
  const protectLvl = $("ropt-lvl").checked;

  // 1. Base query determining stars selection
  let baseQuery = "";
  if (protectIv) {
    baseQuery = "0*,1*,2*";
  } else if (protectHundo) {
    baseQuery = "0*,1*,2*,3*";
  }

  // 2. Build list of native status exclusions
  const parts = [];
  if (baseQuery) {
    parts.push(baseQuery);
  }

  if (protectShiny || $("ropt-ex-shiny").checked) {
    parts.push("!shiny");
  }
  if (protectShadow || $("ropt-ex-shadow").checked) {
    parts.push("!shadow");
  }
  if (protectLucky || $("ropt-ex-lucky").checked) {
    parts.push("!lucky");
  }
  if (protectFav || $("ropt-ex-fav").checked) {
    parts.push("!favorite");
  }
  if ($("ropt-ex-legendary").checked) {
    parts.push("!legendaryry");
  }
  if ($("ropt-ex-mythical").checked) {
    parts.push("!mythical");
  }
  if ($("ropt-ex-ub").checked) {
    parts.push("!ultrabeast");
  }
  if ($("ropt-ex-costume").checked) {
    parts.push("!costume");
  }
  if ($("ropt-ex-purified").checked) {
    parts.push("!purified");
  }
  if ($("ropt-ex-buddy").checked) {
    parts.push("!buddy");
  }
  if ($("ropt-ex-defender").checked) {
    parts.push("!defender");
  }
  if ($("ropt-ex-mega").checked) {
    parts.push("!mega");
  }
  if ($("ropt-cp").checked) {
    const cpVal = $("ropt-cp-val").value;
    if (cpVal) {
      parts.push(`cp-${cpVal}`);
    }
  }

  // Helper function to see if specimen is already filtered out natively
  function isCovered(p) {
    if (p.shiny && (protectShiny || $("ropt-ex-shiny").checked)) return true;
    if (p.shadow && (protectShadow || $("ropt-ex-shadow").checked)) return true;
    if (p.lucky && (protectLucky || $("ropt-ex-lucky").checked)) return true;
    if (p.fav && (protectFav || $("ropt-ex-fav").checked)) return true;
    if ((p.hundo || p.iv_pct === 100) && (protectIv || protectHundo)) return true;
    if (p.iv_pct >= 82.2 && protectIv) return true;
    return false;
  }

  // 3. Species ID exclusions for protected specimens that are not covered
  const protectPids = new Set();
  S.pokemons.forEach(p => {
    const isSpecimenProtected = (protectHundo && (p.hundo || p.iv_pct === 100))
      || (protectNando && p.iv_pct === 0)
      || (protectShiny && p.shiny)
      || (protectShadow && p.shadow)
      || (protectLucky && p.lucky)
      || (protectFav && p.fav)
      || (protectMeta && p.best_tier && (p.best_tier.startsWith("S") || p.best_tier.startsWith("A")))
      || (protectIv && p.iv_pct >= 82.2)
      || (p.cp >= cpMin)
      || (protectPvp && p.gl_rank > 0 && p.gl_rank <= 500)
      || (protectLvl && p.lvl >= 35);

    if (isSpecimenProtected && !isCovered(p)) {
      protectPids.add(p.pid);
    }
  });

  // Append exclusions by Pokedex ID
  protectPids.forEach(pid => {
    parts.push(`!${pid}`);
  });

  const fullQuery = parts.join("&");
  if (!fullQuery) return null;

  // Let's count how many pokemons in user box are matching this query string to show correct UI stats
  let selectedCount = 0;
  S.pokemons.forEach(p => {
    let matchesBase = true;
    if (protectIv) {
      matchesBase = (p.iv_pct < 82.2);
    } else if (protectHundo) {
      matchesBase = (p.iv_pct < 100);
    }

    if (!matchesBase) return;

    let excluded = false;
    if ((protectShiny || $("ropt-ex-shiny").checked) && p.shiny) excluded = true;
    if ((protectShadow || $("ropt-ex-shadow").checked) && p.shadow) excluded = true;
    if ((protectLucky || $("ropt-ex-lucky").checked) && p.lucky) excluded = true;
    if ((protectFav || $("ropt-ex-fav").checked) && p.fav) excluded = true;
    if (protectPids.has(p.pid)) excluded = true;

    if (!excluded) {
      selectedCount++;
    }
  });

  const LIMIT = 300;
  if (fullQuery.length <= LIMIT) {
    return { chunks: [fullQuery], skipped: S.pokemons.length - selectedCount, total: S.pokemons.length };
  } else {
    // Break the PIDs if the string exceeds limit
    const baseExclusionsParts = parts.filter(pt => !pt.startsWith("!"));
    const pidParts = parts.filter(pt => pt.startsWith("!"));

    const chunks = [];
    let curPids = [];
    let curLen = baseExclusionsParts.join("&").length;

    for (const pidPart of pidParts) {
      const addLen = curPids.length ? pidPart.length + 1 : pidPart.length;
      if (curPids.length && curLen + addLen > LIMIT) {
        chunks.push(baseExclusionsParts.concat(curPids).join("&"));
        curPids = [pidPart];
        curLen = baseExclusionsParts.join("&").length + pidPart.length;
      } else {
        curPids.push(pidPart);
        curLen += addLen;
      }
    }
    if (curPids.length) {
      chunks.push(baseExclusionsParts.concat(curPids).join("&"));
    }
    return { chunks, skipped: S.pokemons.length - selectedCount, total: S.pokemons.length };
  }
}

// ── CSV Export ────────────────────────────────────────────────────────────────
$("btn-export-csv").addEventListener("click", () => {
  const list = sortPokes(S.pokemons);
  const headers = ["Nazwa","Pseudonim","CP","Lvl","IV%","Atk","Def","Sta","Year",
                   "Shiny","Shadow","Lucky","Hundo","Ulubiony","Hatched","Tier","Events"];
  const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const rows = list.map(p => [
    p.name, p.nick || "", p.cp, p.lvl, p.iv_pct,
    p.iv_a, p.iv_d, p.iv_s, p.year || "",
    p.shiny  ? "TAK" : "",
    p.shadow ? "TAK" : "",
    p.lucky  ? "TAK" : "",
    p.hundo  ? "TAK" : "",
    p.fav    ? "TAK" : "",
    p.hatched ? 'Yes' : '',
    p.best_tier || "",
    (p.event_tags || []).join("; "),
  ]);
  const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "pokego_box.csv"; a.click();
  URL.revokeObjectURL(url);
});

$("btn-copy-regex").addEventListener("click", () => {
  const result = buildPogoQuery();
  if (!result) return;
  const { chunks, skipped, total } = result;

  if (!chunks) {
    alert(`All ${total} species have protected specimens. Adjust the filters to generate a query.`);
    return;
  }

  // Show multiple query batches for manual copying.
  if (chunks.length > 1) {
    const msg = `Too many IDs — split into ${chunks.length} batches (each ≤300 characters):\n\n`
      + chunks.map((c, i) => `Batch ${i+1}:\n${c}`).join("\n\n");
    alert(msg);
    $("regex-hint").textContent = `${chunks.length} batches · ${total - skipped} species`;
    return;
  }

  const query = chunks[0];
  navigator.clipboard.writeText(query).then(() => {
    const btn  = $("btn-copy-regex");
    const prev = btn.textContent;
    btn.textContent = skipped ? `✓ Copied (${total - skipped}/${total} species)` : `✓ ${total - skipped} species`;
    btn.style.color = "var(--green)";
    btn.style.borderColor = "var(--green)";
    $("regex-hint").textContent = query.length > 60 ? query.slice(0, 57) + "…" : query;
    setTimeout(() => { btn.textContent = prev; btn.style.color = ""; btn.style.borderColor = ""; }, 3000);
  });
});

function updatePogoQuery() {
  const result = buildPogoQuery();
  const input = $("regex-query-input");
  const hint = $("regex-hint");
  if (!result || !result.chunks || result.chunks.length === 0) {
    if (input) input.value = "";
    if (hint) hint.textContent = "All protected";
    return;
  }
  const { chunks, skipped, total } = result;
  if (input) {
    input.value = chunks.join(" | ");
  }
  if (hint) {
    hint.textContent = `${chunks.length} chunks · ${total - skipped} species`;
  }
}

// ── Items ─────────────────────────────────────────────────────────────────────
async function loadItems() {
  S.items = await api("/api/items");
  renderItems();
}

function renderItems() {
  const render=items=>items.map(it=>'<article class="item-card">'+(it.category==='event_points'?mdiIcon('information-outline'):gameAsset('item',it.name,false,it))+'<div class="item-copy"><strong>'+escapeHtml(it.name)+'</strong><span class="supporting-text">Item #'+escapeHtml(it.id)+'</span><code>'+escapeHtml(it.raw_name||'No export name supplied')+'</code><p class="supporting-text">'+escapeHtml(it.description||'Inventory item reported by the export.')+'</p></div><span class="item-count">×'+Number(it.count).toLocaleString('en-US')+'</span></article>').join('');
  $('items-grid').innerHTML=render(S.items.filter(it=>it.category!=='event_points'))||'<p>No inventory items reported.</p>';
  $('event-points-grid').innerHTML=render(S.items.filter(it=>it.category==='event_points'))||'<p>No event-pass counters reported.</p>';
}

$("btn-analyze-items").addEventListener("click", async () => {
  const btn = $("btn-analyze-items");
  btn.disabled = true;
  btn.textContent = "⏳ Analyzing…";
  try {
    const d = await api("/api/analyze-items", { method: "POST", body: "{}" });
    $("items-ai-title").innerHTML = "Inventory analysis " + (d.cached ? '<span class="badge badge-lucky">cached</span>' : "");
    $("items-ai-body").innerHTML  = mdToHtml(d.response);
    $("items-ai-result").style.display = "block";
  } catch (e) {
    alert("AI error: " + e.message);
  }
  btn.disabled = false;
  btn.textContent = "🤖 AI Analysis — what to use on whom";
});

// ── Events ────────────────────────────────────────────────────────────────────
async function loadEvents() {
  S.events = await api("/api/events");
  renderEvents();
}

$("btn-refresh-events").addEventListener("click", async () => {
  $("btn-refresh-events").textContent = "⏳";
  await api("/api/events/refresh", { method: "POST", body: "{}" });
  await loadEvents();
  $("btn-refresh-events").textContent = "🔄 Refresh events";
});

$("events-filter").addEventListener("change", renderEvents);
$("events-tier-filter").addEventListener("change", renderEvents);
$("events-search").addEventListener("input", renderEvents);

function renderEvents() {
  const filt = $("events-filter").value;
  const tierFilt = $("events-tier-filter").value;
  const searchVal = $("events-search").value.toLowerCase().trim();
  
  let list = S.events;
  
  // 1. Status Filter
  if (filt !== "all") {
    list = list.filter(ev => ev.status === filt);
  }
  
  // 2. Search & Tier Filter
  list = list.filter(ev => {
    // Search match (checks title, pokemon names, and evolution names)
    const matchesSearch = !searchVal || 
      ev.name.toLowerCase().includes(searchVal) ||
      (ev.featured_pokemons && ev.featured_pokemons.some(p => 
        p.name.toLowerCase().includes(searchVal) || 
        (p.evolves_to && p.evolves_to.toLowerCase().includes(searchVal))
      ));
      
    if (!matchesSearch) return false;
    
    // Tier filter match
    if (tierFilt !== "all") {
      if (!ev.featured_pokemons || ev.featured_pokemons.length === 0) return false;
      const hasMatchingPoke = ev.featured_pokemons.some(p => {
        if (!p.tiers) return false;
        const ratings = Object.values(p.tiers);
        if (tierFilt === "s_only") {
          return ratings.some(r => r && r.toUpperCase().startsWith("S"));
        } else if (tierFilt === "meta") {
          return ratings.some(r => r && ["S", "A", "B"].some(t => r.toUpperCase().startsWith(t)));
        }
        return false;
      });
      if (!hasMatchingPoke) return false;
    }
    
    return true;
  });

  // Sort list: Active (ending soonest) -> Upcoming (starting soonest) -> Ended (recently ended first)
  list.sort((a, b) => {
    const statusOrder = { active: 1, upcoming: 2, ended: 3 };
    const orderA = statusOrder[a.status] || 99;
    const orderB = statusOrder[b.status] || 99;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    const startA = a.start ? new Date(a.start) : new Date(0);
    const startB = b.start ? new Date(b.start) : new Date(0);
    const endA = a.end ? new Date(a.end) : new Date(0);
    const endB = b.end ? new Date(b.end) : new Date(0);
    
    if (a.status === "active") {
      return endA - endB;
    } else if (a.status === "upcoming") {
      return startA - startB;
    } else {
      return endB - endA;
    }
  });

  function getEventTimeStatus(ev) {
    if (!ev.start || !ev.end) return "";
    const now = new Date();
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    
    if (now < start) {
      const diff = start - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const text = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
      return `<span class="event-countdown-upcoming" title="${ev.start}">⏳ Starts in: ${text}</span>`;
    } else if (now >= start && now <= end) {
      const diff = end - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const text = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
      return `<span class="event-countdown-active" title="${ev.end}">⚡ Active (ends in: ${text})</span>`;
    } else {
      return `<span style="color:var(--muted); font-size:11px;">⬜ Event ended</span>`;
    }
  }

  const tierClass = (r) => {
    if (!r) return "";
    const first = r.charAt(0).toUpperCase();
    return `tb-${first.toLowerCase()}`;
  };

  $("events-list").innerHTML = list.map(ev => {
    const statusCls   = { active:"status-active", upcoming:"status-upcoming", ended:"status-ended" }[ev.status] || "";
    let statusLabel = "";
    if (ev.status === "active") {
      statusLabel = "🟢 Active";
    } else if (ev.status === "upcoming") {
      if (ev.days_until !== null && ev.days_until !== undefined) {
        statusLabel = ev.days_until > 0 ? `🔵 In ${ev.days_until}d` : "🔵 In <24h";
      } else {
        statusLabel = "🔵 Upcoming";
      }
    } else {
      statusLabel = "⬜ Ended";
    }
    const bonuses = ev.bonuses.slice(0,6).map(b => `<span style="font-size:11px">• ${typeof b === "string" ? b : JSON.stringify(b)}</span>`).join("<br>");
    
    // Render featured pokemons cards
    let pokesHtml = "";
    if (ev.featured_pokemons && ev.featured_pokemons.length > 0) {
      const sortedPokes = [...ev.featured_pokemons].sort((a, b) => {
        const weights = {
          'S+': 1, 'S': 2, 'S-': 3,
          'A+': 4, 'A': 5, 'A-': 6,
          'B+': 7, 'B': 8, 'B-': 9,
          'C+': 10, 'C': 11, 'C-': 12,
          'D+': 13, 'D': 14, 'D-': 15
        };
        const getBestWeight = (tiers) => {
          if (!tiers) return 999;
          const ratings = Object.values(tiers);
          let best = 999;
          ratings.forEach(r => {
            if (!r) return;
            const w = weights[r.toUpperCase()] || 100;
            if (w < best) best = w;
          });
          return best;
        };
        return getBestWeight(a.tiers) - getBestWeight(b.tiers);
      });
      
      const pokeCards = sortedPokes.map(p => {
        const shinyBadge = p.can_be_shiny ? tagBadge('shiny','Shiny available') : "";
        const evoLabel = p.is_evolution && p.evolves_to ? `<div class="event-poke-evo">Evolves into: <b>${p.evolves_to}</b></div>` : "";
        const sourceTag = p.source ? `<span class="event-poke-source">${p.source}</span>` : "";
        
        const tierBadges = [];
        if (p.tiers) {
          if (p.tiers.raid)       tierBadges.push(`<span class="tier-badge ${tierClass(p.tiers.raid)}">⚔️ R: ${p.tiers.raid}</span>`);
          if (p.tiers.pvp_great)  tierBadges.push(`<span class="tier-badge ${tierClass(p.tiers.pvp_great)}">🏆 GL: ${p.tiers.pvp_great}</span>`);
          if (p.tiers.pvp_ultra)  tierBadges.push(`<span class="tier-badge ${tierClass(p.tiers.pvp_ultra)}">🏆 UL: ${p.tiers.pvp_ultra}</span>`);
          if (p.tiers.pvp_master) tierBadges.push(`<span class="tier-badge ${tierClass(p.tiers.pvp_master)}">🏆 ML: ${p.tiers.pvp_master}</span>`);
        }
        
        const tiersHtml = tierBadges.length > 0 
          ? `<div class="event-poke-tiers">${tierBadges.join("")}</div>` 
          : `<div style="font-size: 10px; color: var(--muted); font-style: italic;">No meta data</div>`;
          
        const isRaidBoss = p.source && p.source.toLowerCase().includes("raid");
        const counterBtn = isRaidBoss ? `<button class="btn btn-outline btn-xs" style="margin-top:6px;width:100%;font-size:9px" onclick="showRaidCounters('${p.name.replace(/'/g, "\\'")}')">⚔️ ${"Counters"}</button>` : "";
          
        return `<div class="event-poke-card">
          ${gameAsset("pokemon", p.name)}
          <div class="event-poke-details">
            <div class="event-poke-name-row">
              <span>${p.name}</span>
              ${shinyBadge}
            </div>
            ${evoLabel}
            ${tiersHtml}
            ${sourceTag}
            ${counterBtn}
          </div>
        </div>`;
      }).join("");
      
      pokesHtml = `
        <div class="event-pokes-title">Pokémony w wydarzeniu:</div>
        <div class="event-pokes-list">${pokeCards}</div>
      `;
    }

    const countdownHtml = getEventTimeStatus(ev);

    return `<div class="event-card ${ev.status}">
      <div class="event-header">
        <div>
          <div class="event-name">${ev.name}</div>
          <div class="event-meta">
            ${ev.start ? ev.start.replace("T", " ").substring(0, 16) : ""} → ${ev.end ? ev.end.replace("T", " ").substring(0, 16) : ""} · ${ev.type || "Event"}
            ${countdownHtml}
          </div>
          ${ev.link ? `<a href="${ev.link}" target="_blank" style="font-size:11px">🔗 Details</a>` : ""}
        </div>
        <span class="event-status ${statusCls}">${statusLabel}</span>
      </div>
      ${bonuses ? `<div class="event-bonuses">${bonuses}</div>` : ""}
      ${pokesHtml}
      <div class="event-actions">
        <button class="btn btn-primary btn-sm" onclick="generateEventStrategy('${ev.id}')">🤖 Strategia AI</button>
        <div id="ev-loading-${ev.id}" style="display:none;align-items:center;gap:6px">
          <div class="spinner"></div><span style="font-size:11px;color:var(--muted)">Generating…</span>
        </div>
      </div>
      <div id="ev-strategy-${ev.id}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)" class="ai-resp"></div>
    </div>`;
  }).join("") || `<p style="color:var(--muted);font-size:13px">No matching events</p>`;
}

async function generateEventStrategy(evId) {
  const ev = S.events.find(e => e.id === evId);
  if (!ev) return;
  $(`ev-loading-${evId}`).style.display = "flex";
  try {
    const d = await api("/api/event-strategy", {
      method: "POST",
      body: JSON.stringify({ event: ev }),
    });
    const box = $(`ev-strategy-${evId}`);
    box.innerHTML = (d.cached ? '<span class="badge badge-lucky" style="margin-bottom:8px">cached</span><br>' : "")
      + mdToHtml(d.response);
    box.style.display = "block";
  } catch (e) {
    alert("AI error: " + e.message);
  }
  $(`ev-loading-${evId}`).style.display = "none";
}

// ── Tier list ─────────────────────────────────────────────────────────────────
async function loadTiers() {
  S.tiers = await api("/api/tier-list");
  renderTiers();
}

$("btn-refresh-tiers").addEventListener("click", async () => {
  $("btn-refresh-tiers").textContent = "⏳";
  await api("/api/tier-list/refresh", { method: "POST", body: "{}" });
  await loadTiers();
  $("btn-refresh-tiers").textContent = "🔄 Refresh now";
});

function renderTiers() {
  const cats = {
    raid:       "⚔️ Raids",
    pvp_great:  "🏆 Great League",
    pvp_ultra:  "🏆 Ultra League",
    pvp_master: "🏆 Master League",
  };

  $("tier-by-cat").innerHTML = Object.entries(cats).map(([cat, label]) => {
    const byTier = {};
    Object.entries(S.tiers).forEach(([name, cats]) => {
      const t = cats[cat];
      if (t) (byTier[t] = byTier[t] || []).push(name);
    });

    const rows = ["S","A","B","C","D"].map(t => {
      const pokes = (byTier[t] || []).sort();
      if (!pokes.length) return "";
      return `<div class="tier-row">
        <div class="tier-label tier-${t.toLowerCase()}">${t}</div>
        <div class="tier-pokes">${pokes.map(n => `<span class="tier-chip">${n}</span>`).join("")}</div>
      </div>`;
    }).join("");

    return `<div class="card">
      <div class="card-title">${label}</div>
      <div class="tier-grid">${rows || '<p style="color:var(--muted);font-size:12px">No data</p>'}</div>
    </div>`;
  }).join("");
}

// ── AI Modal ──────────────────────────────────────────────────────────────────
const modal    = $("ai-modal");
const aiClose  = $("ai-box-close");
const aiTitle  = $("ai-box-title");
const aiCached = $("ai-box-cached");
const aiLoading= $("ai-loading");
const aiContent= $("ai-content");

aiClose.addEventListener("click", () => modal.classList.remove("open"));
modal.addEventListener("click",   e => { if (e.target === modal) modal.classList.remove("open"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") modal.classList.remove("open"); });

function openModal(title) {
  aiTitle.textContent   = title;
  aiCached.style.display= "none";
  aiContent.innerHTML   = "";
  aiLoading.style.display = "flex";
  modal.classList.add("open");
}

function setModalContent(html, cached) {
  aiLoading.style.display  = "none";
  aiContent.innerHTML      = html;
  aiCached.style.display   = cached ? "inline-block" : "none";
}

async function showRaidCounters(bossName) {
  const title = `Best counters for: ${bossName}`;
  openModal(title);
  try {
    const res = await fetch(`/api/raid-counters?boss=${encodeURIComponent(bossName)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Unable to load data");
    }
    const data = await res.json();
    
    let html = "";
    if (data.boss_types) {
      const typesHtml = data.boss_types.map(t => `<span class="badge" style="background:var(--bg3);border:1px solid var(--border);text-transform:uppercase;font-size:10px">${t}</span>`).join(" ");
      html += `<div style="margin-bottom:15px;font-size:12px;color:var(--muted)">
        ${"Boss types:"} ${typesHtml}
      </div>`;
    }
    
    if (data.counters && data.counters.length > 0) {
      html += `<div class="tbl-wrap">
        <table style="width:100%;font-size:12px">
          <thead>
            <tr>
              <th>Pokémon</th>
              <th>CP</th>
              <th>Lvl</th>
              <th>IV</th>
              <th>${"Fast Move"}</th>
              <th>${"Charged Move"}</th>
              <th style="text-align:right">${"Score"}</th>
            </tr>
          </thead>
          <tbody>`;
          
      data.counters.forEach(c => {
        const shinyBadge = c.shiny ? `${tagBadge('shiny','Shiny')}` : "";
        const shadowBadge = c.shadow ? `${tagBadge('shadow','Shadow')}` : "";
        const luckyBadge = c.lucky ? `${tagBadge('lucky','Lucky')}` : "";
        
        html += `<tr>
          <td style="font-weight:700">
            ${c.name} ${shinyBadge} ${shadowBadge} ${luckyBadge}
          </td>
          <td class="mono">${c.cp}</td>
          <td class="mono">${c.lvl}</td>
          <td class="mono" style="color:var(--accent)">${c.iv_pct}%</td>
          <td>
            <span class="move-tag type-${c.fast_move_type}" style="font-size:10px">${c.fast_move}</span>
          </td>
          <td>
            <span class="move-tag type-${c.charged_move_type}" style="font-size:10px">${c.charged_move}</span>
          </td>
          <td style="text-align:right;font-weight:800;color:var(--green)">
            ${c.counter_score}
          </td>
        </tr>`;
      });
      
      html += `</tbody></table></div>`;
    } else {
      html += `<p class="alert alert-info">${"You do not have any Pokémon in your box to counter this boss."}</p>`;
    }
    setModalContent(html, false);
  } catch (err) {
    setModalContent(`<p class="alert alert-err">${"Error: "} ${err.message}</p>`, false);
  }
}

async function analyzeOnePokemon(idx) {
  const p = S.pokemons[idx];
  if (!p) return;
  openModal(`${p.name} — AI analysis`);
  try {
    const d = await api("/api/analyze-pokemon", {
      method: "POST",
      body: JSON.stringify({ pokemon: p }),
    });
    setModalContent(mdToHtml(d.response), d.cached);
  } catch (e) {
    setModalContent(`<p class="alert alert-err">Error: ${e.message}</p>`, false);
  }
}

// ── Config & cache stats ──────────────────────────────────────────────────────
async function loadConfig() {
  const cfg = await api("/api/config");
  $("cfg-provider").value = cfg.provider;
}

async function loadCacheStats() {
  const s = await api("/api/cache/stats");
  $("cs-total").textContent = s.total;
  $("cs-today").textContent = s.today;
  $("cs-saved").textContent = `~${s.est_saved_usd}`;
}

// ── Raid ──────────────────────────────────────────────────────────────────────
let _raidData = [];
async function loadRaid() {
  _raidData = await api("/api/raid-candidates");
  renderRaid();
}

function renderRaid() {
  $("raid-tbody").innerHTML = _raidData.map((p, i) => {
    const tiers = p.tiers || {};
    const tb = Object.entries(tiers).map(([cat, t]) =>
      `<span class="badge badge-${t.charAt(0).toLowerCase()}">${cat.split("_").pop().toUpperCase()} ${t}</span>`).join("");
    const tags = [
      p.shiny  ? `${tagBadge('shiny','Shiny')}` : "",
      p.shadow ? `${tagBadge('shadow','Shadow')}` : "",
      p.hundo  ? `${tagBadge('hundo','Hundo')}` : "",
      p.lucky  ? `${tagBadge('lucky','Lucky')}` : "",
    ].join("");
    
    let movesetHtml = '<div style="display: flex; flex-direction: column; gap: 4px; line-height: 1.2;">';
    if (p.pve_combos && p.pve_combos.length > 0) {
      p.pve_combos.forEach((combo) => {
        const fClean = combo.fast_name.replace('*', '');
        const cClean = combo.charged_name.replace('*', '');
        const isMatch = p.curr_moves && p.curr_moves.includes(fClean) && p.curr_moves.includes(cClean);
        
        const bullet = isMatch ? '<span style="color: var(--green); font-weight: bold; margin-right: 4px;">✔️</span>' : '<span style="color: #64748b; margin-right: 4px;">•</span>';
        const color = isMatch ? 'color: var(--green); font-weight: 600;' : 'color: #94a3b8; font-size: 11px;';
        
        const typeLabel = combo.fast_type === combo.charged_type ? combo.fast_type : `${combo.fast_type}/${combo.charged_type}`;
        
        movesetHtml += `
          <div style="display: flex; align-items: center; ${color}">
            ${bullet}
            <span>${combo.fast_name} + ${combo.charged_name}</span>
            <span style="font-size: 9px; color: #64748b; margin-left: 6px; font-weight: normal;">(${typeLabel})</span>
          </div>`;
      });
    } else {
      movesetHtml += '<div style="color: var(--muted);">—</div>';
    }
    movesetHtml += '</div>';

    return `<tr>
      <td style="color:var(--muted);font-weight:700;font-family:var(--fm)">${i+1}</td>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}
        ${pokemonIdentity(p)}
        ${p.move1_name ? `
        <div class="moves-row" style="margin-top: 3px;">
          <span class="move-tag type-${p.move1_type}" style="font-size: 9px; padding: 2px 4px;">${p.move1_name}</span>
          ${p.move2_name ? `<span class="move-tag type-${p.move2_type}" style="font-size: 9px; padding: 2px 4px;">${p.move2_name}</span>` : ''}
          ${p.move3_name ? `<span class="move-tag type-${p.move3_type}" style="font-size: 9px; padding: 2px 4px;">${p.move3_name}</span>` : ''}
        </div>` : ''}
      </td>
      <td class="cp-cell">${p.cp}</td>
      <td class="mono">${p.lvl}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td class="mono">${p.iv_a}/${p.iv_d}/${p.iv_s}</td>
      <td style="color:var(--cyan);font-weight:600;font-family:var(--fm)">${p.max_cp ? p.max_cp.toLocaleString() : "—"}</td>
      <td><div class="mono" style="text-align: left;">${movesetHtml}</div></td>
      <td>${tb || '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td>${tags}</td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${S.pokemons.indexOf(S.pokemons.find(x=>x.pid===p.pid&&x.cp===p.cp))})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="11" style="padding:24px;text-align:center;color:var(--muted)">No data — upload a JSON export</td></tr>`;
}

// ── PvP ───────────────────────────────────────────────────────────────────────
let _pvpData = {GL:[], UL:[], ML:[]};
let _pvpLocalTeams = {GL:[], UL:[], ML:[]};
let _pvpBestByRole = {GL: null, UL: null, ML: null};
let _pvpLeague = "GL";

$$(".tab-sub").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".tab-sub").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _pvpLeague = btn.dataset.league;
    $("pvp-ai-result").style.display = "none";
    if (!_pvpData[_pvpLeague].length) {
      loadPvP(_pvpLeague);
    } else {
      renderPvP();
      renderLocalTeams(_pvpLocalTeams[_pvpLeague]);
      renderBestByRole(_pvpBestByRole[_pvpLeague]);
    }
  });
});

async function loadPvP(league) {
  const res = await api(`/api/pvp-candidates?league=${league}`);
  _pvpData[league] = res.candidates || [];
  _pvpLocalTeams[league] = res.local_teams || [];
  _pvpBestByRole[league] = res.best_by_role || { leads: [], switches: [], closers: [] };
  if (_pvpLeague === league) {
    renderPvP();
    renderLocalTeams(_pvpLocalTeams[league]);
    renderBestByRole(_pvpBestByRole[league]);
  }
}

function renderBestByRole(data) {
  const container = $("pvp-best-by-role");
  if (!container) return;
  if (!data || (!data.leads.length && !data.switches.length && !data.closers.length)) {
    container.style.display = "none";
    return;
  }
  container.style.display = "grid";
  
  const makeList = (pokes) => {
    if (!pokes || pokes.length === 0) return `<div style="font-size:11px;color:var(--muted)">${"No candidates"}</div>`;
    return pokes.map(p => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg3); padding:6px 10px; border-radius:6px; border:1px solid var(--border2);">
        <b style="font-size:11px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;" title="${p.name}">${p.name}</b>
        <div style="display:flex; gap:6px; font-family:var(--fm); font-size:9px;">
          <span style="color:var(--muted);">CP ${p.cp}</span>
          <span style="color:var(--accent);">Rank #${p.pvp_rank}</span>
        </div>
      </div>
    `).join("");
  };

  container.innerHTML = `
    <!-- LEADS -->
    <div style="background:var(--bg3); padding:10px; border-radius:8px; border:1px solid var(--border2); display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;">
          🚀 ${"Leads"}
          <span style="cursor:help; font-size:10px; color:var(--muted)" data-tooltip="${'Start the battle. Exert shield pressure or win neutral matchups.'}">ℹ️</span>
        </span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${makeList(data.leads)}
      </div>
    </div>
    
    <!-- SWITCHES -->
    <div style="background:var(--bg3); padding:10px; border-radius:8px; border:1px solid var(--border2); display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;">
          🛡️ ${"Safe Switches"}
          <span style="cursor:help; font-size:10px; color:var(--muted)" data-tooltip="${'Safe switch-in after losing lead. High bulk and safe matchups.'}">ℹ️</span>
        </span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${makeList(data.switches)}
      </div>
    </div>
    
    <!-- CLOSERS -->
    <div style="background:var(--bg3); padding:10px; border-radius:8px; border:1px solid var(--border2); display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; display:inline-flex; align-items:center; gap:4px;">
          💣 ${"Closers"}
          <span style="cursor:help; font-size:10px; color:var(--muted)" data-tooltip="${'Close the battle. Deal heavy damage when opponent has no shields left.'}">ℹ️</span>
        </span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${makeList(data.closers)}
      </div>
    </div>
  `;
}

function renderLocalTeams(teams) {
  const container = $("pvp-local-teams-list");
  if (!teams || teams.length === 0) {
    $("pvp-local-teams-card").style.display = "none";
    return;
  }
  
  const leagueColor = { GL: "var(--cyan)", UL: "var(--purple)", ML: "var(--yellow)" }[_pvpLeague];
  
  container.innerHTML = teams.map((team, idx) => {
    const leadLbl = "Lead";
    const switchLbl = "Safe Switch";
    const closerLbl = "Closer";
    const teamLbl = `Team #${idx + 1}`;
    const descText = `Balanced team with <b>${team.lead.name}</b> as lead, <b>${team.switch.name}</b> as safe switch, and <b>${team.closer.name}</b> as closer.`;

    return `
      <div style="background: var(--bg3); padding: 12px; border-radius: 8px; border: 1px solid var(--border2); display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <b style="color: var(--text); font-size: 13px;">${teamLbl}</b>
          <span style="font-size: 11px; color: ${leagueColor}; font-weight: 700; font-family: var(--fm);">${_pvpLeague}</span>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 4px;">
          <!-- LEAD -->
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; background: var(--bg2); padding: 8px; border-radius: 6px; border: 1px solid var(--border); overflow: hidden;">
            <span style="font-size: 8px; color: var(--muted); text-transform: uppercase; font-weight: 700;">${leadLbl}</span>
            <b style="font-size: 11px; color: var(--text); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;" title="${team.lead.name}">${team.lead.name}</b>
            <span style="font-size: 10px; color: var(--muted); margin-top: 2px; font-family: var(--fm)">CP ${team.lead.cp}</span>
            <span style="font-size: 9px; color: var(--accent); font-family: var(--fm)">Rank #${team.lead.pvp_rank}</span>
          </div>
          <!-- SWITCH -->
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; background: var(--bg2); padding: 8px; border-radius: 6px; border: 1px solid var(--border); overflow: hidden;">
            <span style="font-size: 8px; color: var(--muted); text-transform: uppercase; font-weight: 700;">${switchLbl}</span>
            <b style="font-size: 11px; color: var(--text); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;" title="${team.switch.name}">${team.switch.name}</b>
            <span style="font-size: 10px; color: var(--muted); margin-top: 2px; font-family: var(--fm)">CP ${team.switch.cp}</span>
            <span style="font-size: 9px; color: var(--accent); font-family: var(--fm)">Rank #${team.switch.pvp_rank}</span>
          </div>
          <!-- CLOSER -->
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; background: var(--bg2); padding: 8px; border-radius: 6px; border: 1px solid var(--border); overflow: hidden;">
            <span style="font-size: 8px; color: var(--muted); text-transform: uppercase; font-weight: 700;">${closerLbl}</span>
            <b style="font-size: 11px; color: var(--text); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;" title="${team.closer.name}">${team.closer.name}</b>
            <span style="font-size: 10px; color: var(--muted); margin-top: 2px; font-family: var(--fm)">CP ${team.closer.cp}</span>
            <span style="font-size: 9px; color: var(--accent); font-family: var(--fm)">Rank #${team.closer.pvp_rank}</span>
          </div>
        </div>
        
        <div style="font-size: 11px; color: var(--muted); font-style: italic; line-height: 1.4; margin-top: 2px;">
          💡 ${descText}
        </div>
      </div>
    `;
  }).join("");
  
  $("pvp-local-teams-card").style.display = "block";
}

function pvpRankBadge(rank, total, pct) {
  if (!rank || !total) return '<span style="color:var(--muted);font-size:10px">—</span>';
  const frac = rank / total;
  let cls;
  if (rank === 1)       cls = "rank-1";
  else if (frac <= .01) cls = "rank-top1";
  else if (frac <= .05) cls = "rank-top5";
  else if (frac <= .10) cls = "rank-top10";
  else                  cls = "rank-ok";
  const pctStr = pct != null ? ` ${pct}%` : "";
  return `<span class="rank-badge ${cls}" title="#${rank} z ${total}">#${rank}${pctStr}</span>`;
}

function renderPvP() {
  const data = _pvpData[_pvpLeague];
  const leagueColor = {GL:"var(--cyan)", UL:"var(--purple)", ML:"var(--yellow)"}[_pvpLeague];
  $("pvp-tbody").innerHTML = data.map((p, i) => {
    const tiers = p.tiers || {};
    let tb = "";
    const keyMap = { GL: "pvp_great", UL: "pvp_ultra", ML: "pvp_master" };
    const t = tiers[keyMap[_pvpLeague]];
    if (t) {
      tb = `<span class="badge badge-${t.charAt(0).toLowerCase()}">${_pvpLeague} ${t}</span>`;
    }
    const tags = [
      p.shiny  ? `${tagBadge('shiny','Shiny')}` : "",
      p.shadow ? `${tagBadge('shadow','Shadow')}` : "",
      p.hundo  ? `${tagBadge('hundo','Hundo')}` : "",
      p.lucky  ? `${tagBadge('lucky','Lucky')}` : "",
    ].join("");
    const rankBadge = pvpRankBadge(p.pvp_rank, p.pvp_rank_total, p.pvp_rank_pct);
    return `<tr>
      <td style="color:var(--muted);font-weight:700;font-family:var(--fm)">${i+1}</td>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}${p.name}</td>
      <td class="cp-cell">${p.cp}</td>
      <td style="font-weight:700;color:${leagueColor};font-family:var(--fm)">${p.pvp_cp || "—"}</td>
      <td class="mono">${p.pvp_lvl || p.lvl}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td class="mono">${p.iv_a}/${p.iv_d}/${p.iv_s}</td>
      <td>
        ${rankBadge}
        <div style="font-size: 9px; color: var(--muted); margin-top: 2px; font-family: var(--fm); white-space: nowrap;">Ideal: ${p.pvp_ideal || "—"}</div>
      </td>
      <td>${tb || '<span style="color:var(--muted);font-size:10px">—</span>'}</td>
      <td>${tags}</td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${S.pokemons.indexOf(S.pokemons.find(x=>x.pid===p.pid&&x.cp===p.cp))})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="11" style="padding:24px;text-align:center;color:var(--muted)">No data</td></tr>`;
}

$("btn-analyze-pvp").addEventListener("click", async () => {
  const btn = $("btn-analyze-pvp");
  btn.disabled = true;
  btn.textContent = "⏳ Analyzing PvP teams…";
  
  try {
    const d = await api("/api/analyze-pvp-teams", {
      method: "POST",
      body: JSON.stringify({ league: _pvpLeague })
    });
    
    const leagueNames = { GL: "Great League (CP ≤1500)", UL: "Ultra League (CP ≤2500)", ML: "Master League" };
    const leagueName = leagueNames[_pvpLeague] || _pvpLeague;
    $("pvp-ai-title").innerHTML = `PvP team analysis for ${leagueName} ` 
      + (d.cached ? '<span class="badge badge-lucky">cached</span>' : "");
    $("pvp-ai-body").innerHTML = mdToHtml(d.response);
    $("pvp-ai-result").style.display = "block";
  } catch (e) {
    alert("AI error: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 AI Analysis — PvP Teams";
  }
});

// ── PvP Gems & Purify Comparison ──────────────────────────────────────────────
let _pvpGems = [];
async function loadPvpGems() {
  try {
    const res = await api("/api/pvp-hidden-gems");
    _pvpGems = res || [];
    renderPvpGems();
  } catch (e) {
    console.error("Failed to load PvP gems:", e);
  }
}

function renderPvpGems() {
  const card = $("pvp-gems-card");
  if (!card) return;
  if (_pvpGems.length === 0) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  
  const previewContainer = $("pvp-gems-preview");
  if (previewContainer) {
    previewContainer.innerHTML = _pvpGems.slice(0, 6).map(g => {
      const leagueBadge = g.gem_league.startsWith("GL") ? "badge-gl" : g.gem_league.startsWith("UL") ? "badge-ul" : "badge-ll";
      return `<div style="background:var(--bg3); padding:4px 8px; border-radius:6px; border:1px solid var(--border2); font-size:11px; display:flex; gap:6px; align-items:center;">
        <b>${g.name}</b>
        <span class="badge ${leagueBadge}" style="font-size:9px; padding:1px 4px;">#${g.gem_rank} ${g.gem_target}</span>
      </div>`;
    }).join("");
  }

  $("pvp-gems-tbody").innerHTML = _pvpGems.map(g => {
    const pIdx = S.pokemons.indexOf(S.pokemons.find(x => x.pid === g.pid && x.cp === g.cp));
    const leagueBadge = g.gem_league.startsWith("GL") ? "badge-gl" : g.gem_league.startsWith("UL") ? "badge-ul" : "badge-ll";
    const tags = [
      g.shiny ? `${tagBadge('shiny','Shiny')}` : "",
      g.shadow ? `${tagBadge('shadow','Shadow')}` : "",
      g.lucky ? `${tagBadge('lucky','Lucky')}` : ""
    ].join("");
    return `<tr>
      <td class="name-cell">${gameAsset("pokemon", g.name, g.shiny)}${g.name} ${tags}</td>
      <td class="cp-cell">${g.cp}</td>
      <td class="mono">${g.lvl}</td>
      <td class="${ivClass(g.iv_pct)}">${g.iv_pct}%</td>
      <td class="mono">${g.iv_a}/${g.iv_d}/${g.iv_s}</td>
      <td style="color:var(--yellow); font-weight:700">→ ${g.gem_target}</td>
      <td><span class="badge ${leagueBadge}">${g.gem_league.split(" ")[0]}</span></td>
      <td>
        <span class="rank-badge ${g.gem_rank <= 10 ? 'rank-s' : g.gem_rank <= 50 ? 'rank-a' : 'rank-b'}" style="font-weight:800;">#${g.gem_rank}</span>
        <span style="font-size:9px; color:var(--muted); margin-left:3px;">(${g.gem_pct}%)</span>
      </td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${pIdx})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="padding:16px;text-align:center;color:var(--muted)">${"No PvP gems in bag"}</td></tr>`;
}

async function showPurifyComparison(index) {
  const p = S.pokemons[index];
  const title = `⚖️ ${p.name} — Purify Simulator`;
  openModal(title);
  try {
    const data = await api(`/api/purify-comparison?index=${index}`);
    
    const html = `
      <p style="font-size:13px; color:var(--muted); margin-bottom:14px;">
        ${"Comparison of parameters before and after purification."}
      </p>
      
      <div class="compare-container">
        <!-- Shadow Card -->
        <div class="compare-card shadow-compare">
          <div class="compare-header" style="color:var(--purple);">
            <span>💀 Shadow</span>
            <span class="badge badge-shadow" style="font-size:9px;">+20% Atk</span>
          </div>
          <div class="compare-stat-row">
            <span>CP</span>
            <b style="color:var(--text);">${data.shadow.cp}</b>
          </div>
          <div class="compare-stat-row">
            <span>${"Level (Lvl)"}</span>
            <b>${data.shadow.lvl}</b>
          </div>
          <div class="compare-stat-row">
            <span>IV %</span>
            <b class="${ivClass(data.shadow.iv_pct)}">${data.shadow.iv_pct}%</b>
          </div>
          <div class="compare-stat-row">
            <span>A / D / S</span>
            <b class="mono">${data.shadow.iv_a} / ${data.shadow.iv_d} / ${data.shadow.iv_s}</b>
          </div>
        </div>

        <!-- Purified Card -->
        <div class="compare-card purified-compare">
          <div class="compare-header" style="color:var(--cyan);">
            <span>${gameStatusIcon('purified')} Purified</span>
            <span class="badge badge-gl" style="font-size:9px; background:rgba(56,189,248,.12); color:#38bdf8; border:1px solid rgba(56,189,248,.3);">${"-10% cost"}</span>
          </div>
          <div class="compare-stat-row">
            <span>CP</span>
            <b style="color:var(--accent); font-weight:800;">${data.purified.cp}</b>
          </div>
          <div class="compare-stat-row">
            <span>${"Level (Lvl)"}</span>
            <b>${data.purified.lvl} <span style="font-size:10px; color:var(--green); font-weight:normal;">(↑ L25)</span></b>
          </div>
          <div class="compare-stat-row">
            <span>IV %</span>
            <b class="${ivClass(data.purified.iv_pct)}">${data.purified.iv_pct}% <span style="font-size:10px; color:var(--green); font-weight:normal;">(+2 each)</span></b>
          </div>
          <div class="compare-stat-row">
            <span>A / D / S</span>
            <b class="mono" style="color:var(--green);">${data.purified.iv_a} / ${data.purified.iv_d} / ${data.purified.iv_s}</b>
          </div>
        </div>
      </div>

      <!-- Cost Section -->
      <div style="background:var(--bg3); padding:10px 14px; border-radius:8px; border:1px solid var(--border2); margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; font-size:13px;">
        <span>💰 ${"Purification cost:"}</span>
        <b style="color:var(--yellow); font-family:var(--fm)">${gameStatusIcon('stardust')} ${data.purify_dust.toLocaleString()} Dust &nbsp;💊 ${data.purify_candy} Candy</b>
      </div>

      <!-- Verdict Section -->
      <div style="background:rgba(255,255,255,0.03); border-left:4px solid var(--accent); padding:12px 16px; border-radius:4px; font-size:13px; line-height:1.5; margin-bottom:20px;">
        ${data.verdict}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <button class="btn btn-secondary" onclick="$('ai-modal').classList.remove('open')" style="padding:6px 12px; font-size:12px; cursor:pointer;">
          ${"Close"}
        </button>
        <button class="btn-ai" onclick="analyzeOnePokemon(${index})" style="padding:6px 14px; font-size:12px;">
          🤖 ${"Ask AI Coach"}
        </button>
      </div>
    `;
    setModalContent(html, false);
  } catch (e) {
    setModalContent(`<p class="alert alert-err">Error: ${e.message}</p>`, false);
  }
}

// ── Develop ────────────────────────────────────────────────────────────────────
let _developData = null;

async function loadDevelop() {
  _developData = await api("/api/develop-candidates");
  renderDevelop();
}

function _devPokeIdx(p) {
  return S.pokemons.indexOf(S.pokemons.find(x => x.pid === p.pid && x.cp === p.cp));
}

function renderDevelop() {
  if (!_developData) return;
  const d = _developData;

  $("dev-evolve-tbody").innerHTML = d.evolve.map(p => {
    const tags = [p.shiny ? `${tagBadge('shiny','Shiny')}` : "",
                  p.lucky ? `${tagBadge('lucky','Lucky')}` : ""].join("");
    const tc = (p.final_tier && p.final_tier.startsWith("S")) ? "badge-s" : "badge-a";
    
    let limitBadge = "";
    if (p.final_cp > 2500) {
      limitBadge = ` <span class="badge badge-err" style="font-size:9px;" data-tooltip="Exceeds the limit for Ultra League (>2500)">>2500</span>`;
    } else if (p.final_cp > 1500) {
      limitBadge = ` <span class="badge badge-warn" style="font-size:9px;" data-tooltip="Exceeds the limit for Great League (>1500)">>1500</span>`;
    }

    return `<tr>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}${p.name}</td>
      <td class="cp-cell">${p.cp}</td>
      <td class="mono">${p.lvl}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td style="color:var(--cyan);font-weight:700">→ ${p.final_name} <span style="color:var(--text);font-weight:400;font-size:11px;">(CP ${p.final_cp || '?'})</span>${limitBadge}</td>
      <td><span class="badge ${tc}">${p.final_tier}</span></td>
      <td>${tags}</td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${_devPokeIdx(p)})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--muted)">No candidates: requires IV ≥80% and a meta final evolution</td></tr>`;

  $("dev-powerup-tbody").innerHTML = d.power_up.map(p => {
    const pIdx = _devPokeIdx(p);
    let options = '<option value="">Choose level</option>';
    let minLvl = p.lvl + 0.5;
    if (minLvl <= 50) {
      for (let l = minLvl; l <= 50; l += 0.5) {
        options += `<option value="${l}">${l}</option>`;
      }
    }
    return `<tr>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}${p.name}</td>
      <td class="cp-cell">${p.cp}</td>
      <td class="mono">${p.lvl}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td class="mono">${p.iv_a}/${p.iv_d}/${p.iv_s}</td>
      <td>
        <select onchange="recalcPowerup(this, ${pIdx})" style="width:75px; padding:2px; font-size:11px; background:var(--bg3); color:var(--text); border:1px solid var(--border); border-radius:4px;">
          ${options}
        </select>
      </td>
      <td class="calc-cell" id="pow-calc-${pIdx}" style="min-width:120px;"><span style="color:var(--muted);font-size:10px">—</span></td>
      <td><button class="btn-ai" onclick="analyzeOnePokemon(${pIdx})">🤖 AI</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" style="padding:16px;text-align:center;color:var(--muted)">No candidates: meta Pokémon below level 40 with IV ≥80%</td></tr>`;

  $("dev-purify-tbody").innerHTML = d.purify.map(p => {
    const pA = Math.min(15, p.iv_a+2), pD = Math.min(15, p.iv_d+2), pS = Math.min(15, p.iv_s+2);
    const tc = (p.best_tier && p.best_tier.startsWith("S")) ? "badge-s" : (p.best_tier && p.best_tier.startsWith("A")) ? "badge-a" : "";
    const pIdx = _devPokeIdx(p);
    const btnLabel = "⚖️ Compare";
    return `<tr>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}${p.name}</td>
      <td class="cp-cell">${p.cp}</td>
      <td class="${ivClass(p.iv_pct)}">${p.iv_pct}%</td>
      <td class="${ivClass(p.purified_iv)}" style="font-weight:700">${p.purified_iv}%</td>
      <td class="mono">${p.iv_a}/${p.iv_d}/${p.iv_s} → <span style="color:var(--green)">${pA}/${pD}/${pS}</span></td>
      <td>${tc ? `<span class="badge ${tc}">${p.best_tier}</span>` : `<span style="color:var(--muted)">—</span>`}</td>
      <td>
        <button class="btn" style="padding:2px 8px; font-size:10px; background:var(--accent); border:none; color:var(--bg1); cursor:pointer; font-weight:700; border-radius:4px; margin-right:4px;" onclick="showPurifyComparison(${pIdx})">${btnLabel}</button>
        <button class="btn-ai" onclick="analyzeOnePokemon(${pIdx})">🤖 AI</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--muted)">No Shadow Pokémon with IV ≥78% before purification</td></tr>`;

  $("dev-tm-tbody").innerHTML = d.elite_tm.map(p => {
    const pidx = _devPokeIdx(p);
    const pvpOpt = p.pvp_optimal && p.pvp_optimal.length ? p.pvp_optimal.join(" + ") : "—";
    const pveOpt = p.pve_optimal && p.pve_optimal.length ? p.pve_optimal.join(" + ") : "—";
    
    let allWarnings = [...new Set((p.pvp_warnings || []).concat(p.pve_warnings || []))];
    let tmLabel = "Zgodne / OK";
    let tmStyle = "color:var(--green); font-size:10px;";
    if (allWarnings.length > 0) {
      tmLabel = allWarnings.map(w => w.split(" ").slice(2).join(" ")).join("<br>");
      tmStyle = "color:var(--yellow); font-size:10px; line-height:1.25;";
    }
    
    const currMoves = [p.move1_name, p.move2_name, p.move3_name].filter(Boolean).join(" + ");

    return `<tr>
      <td class="name-cell">${gameAsset("pokemon", p.species_name || p.name, p.shiny, p)}${p.name}</td>
      <td class="cp-cell">${p.cp}</td>
      <td style="font-size:10px; color:var(--muted); line-height:1.25;">${currMoves}</td>
      <td style="font-size:10px; color:var(--text); line-height:1.25;">${pvpOpt}</td>
      <td style="font-size:10px; color:var(--text); line-height:1.25;">${pveOpt}</td>
      <td style="${tmStyle}">${tmLabel}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted)">No candidates: meta Pokémon at level ≥35</td></tr>`;
  const populatePreview = (id, list) => {
    const el = $(id);
    if (!el) return;
    const content = $(id.replace("-preview", "-content"));
    // If the card is expanded, we do not show the preview chips
    if (content && content.style.display !== "none") {
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    if (!list || list.length === 0) {
      el.innerHTML = `<span style="font-size:10px; color:var(--muted); font-style:italic;">${'No candidates'}</span>`;
      return;
    }
    el.innerHTML = list.slice(0, 3).map(p => `
      <span class="badge" style="background:var(--bg3); border:1px solid var(--border2); color:var(--text); padding: 2px 6px; border-radius: 4px; font-size:10px; font-weight:normal;">
        ${p.name} <span style="color:var(--muted); font-size:9px;">(CP ${p.cp})</span>
      </span>
    `).join(" ");
  };
  populatePreview("dev-evolve-preview", d.evolve);
  populatePreview("dev-powerup-preview", d.power_up);
  populatePreview("dev-purify-preview", d.purify);
  populatePreview("dev-tm-preview", d.elite_tm);
}

$("btn-save-cfg").addEventListener("click", async () => {
  const body = {
    provider:      $("cfg-provider").value,
    gemini_key:    $("cfg-gemini").value,
    openai_key:    $("cfg-openai").value,
    anthropic_key: $("cfg-anthropic").value,
    azure_key:     $("cfg-azure-key").value,
    azure_endpoint:$("cfg-azure-ep").value,
  };
  await api("/api/config", { method: "POST", body: JSON.stringify(body) });
  const saved = $("cfg-saved");
  saved.style.display = "inline";
  setTimeout(() => { saved.style.display = "none"; }, 2500);
});

// ── Auto-restore on page load ─────────────────────────────────────────────────
(async function checkRestoredState() {
  try {
    const status = await api("/api/status");
    if (status.loaded) {
      await onUploadSuccess(status.stats, status.player, status.pvp_stats);
    }
  } catch (_) {}
})();

// ── Custom Tooltips ───────────────────────────────────────────────────────────
(function initCustomTooltips() {
  const tooltipEl = document.createElement("div");
  tooltipEl.id = "custom-tooltip";
  tooltipEl.className = "custom-tooltip";
  document.body.appendChild(tooltipEl);

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (!target) return;
    
    const text = target.getAttribute("data-tooltip");
    if (!text) return;
    
    tooltipEl.innerHTML = text;
    tooltipEl.classList.add("visible");
    
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    
    // Position tooltip above the target by default, or below if not enough space
    let left = rect.left + (rect.width - tooltipRect.width) / 2;
    let top = rect.top - tooltipRect.height - 8 + window.scrollY;
    
    if (top < window.scrollY) {
      top = rect.bottom + 8 + window.scrollY;
    }
    
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }
    
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) {
      tooltipEl.classList.remove("visible");
    }
  });
})();

function makeTableSortable(table) {
  if (!table) return;
  const headers = table.querySelectorAll("thead th");
  headers.forEach((th, index) => {
    const label = th.textContent.trim();
    if (label === "AI" || label === "Tags" || label === "Meta" || label === "Year" || label === "#" || label === "") return;
    
    th.style.cursor = "pointer";
    th.classList.add("sortable-header");
    const indicator=document.createElement('span');indicator.className='sort-indicator';indicator.innerHTML=mdiIcon('sort-ascending');th.appendChild(indicator);
    
    let asc = true;
    th.addEventListener("click", () => {
      const tbody = table.querySelector("tbody");
      if (!tbody) return;
      const rows = Array.from(tbody.querySelectorAll("tr"));
      if (rows.length === 0) return;
      
      headers.forEach(h => {
        if (h !== th) {
          h.classList.remove("sort-asc", "sort-desc");
          const other=h.querySelector('.sort-indicator');if(other)other.innerHTML=mdiIcon('sort-ascending');
        }
      });
      
      indicator.innerHTML=mdiIcon(asc?'sort-ascending':'sort-descending');
      rows.sort((a, b) => {
        const cellA = a.cells[index];
        const cellB = b.cells[index];
        
        let valA = cellA ? cellA.textContent.trim() : "";
        let valB = cellB ? cellB.textContent.trim() : "";
        
        const parseValue = (val) => {
          if (val === "" || val === "—") return -Infinity;
          
          let cleaned = val.replace(/^#/, '').replace(/%/g, '').replace(/,/g, '').replace(/\s/g, '').trim();
          if (cleaned.includes('/')) {
            const parts = cleaned.split('/').map(Number);
            if (parts.every(x => !isNaN(x))) {
              return parts.reduce((x, y) => x + y, 0);
            }
          }
          const num = parseFloat(cleaned);
          return isNaN(num) ? val.toLowerCase() : num;
        };
        
        const pA = parseValue(valA);
        const pB = parseValue(valB);
        
        if (typeof pA === 'number' && typeof pB === 'number') {
          return asc ? pA - pB : pB - pA;
        } else {
          return asc ? String(pA).localeCompare(String(pB)) : String(pB).localeCompare(String(pA));
        }
      });
      
      if (asc) {
        th.classList.add("sort-asc");
        th.classList.remove("sort-desc");
      } else {
        th.classList.add("sort-desc");
        th.classList.remove("sort-asc");
      }
      
      asc = !asc;
      tbody.append(...rows);
    });
  });
}

(function initTableSorting() {
  makeTableSortable($("poke-table"));
  makeTableSortable($("raid-table"));
  makeTableSortable($("pvp-table"));
})();

let chartIvInstance = null;
let chartTypesInstance = null;

function toggleDevCard(contentId) {
  const content = $(contentId);
  const icon = $(contentId.replace("-content", "-toggle-icon"));
  const preview = $(contentId.replace("-content", "-preview"));
  if (content.style.display === "none") {
    content.style.display = "block";
    icon.innerHTML = mdiIcon("chevron-up");
    if (preview) preview.style.display = "none";
  } else {
    content.style.display = "none";
    icon.innerHTML = mdiIcon("chevron-down");
    if (preview) preview.style.display = "flex";
  }
}

function toggleAnalytics() {
  const content = $("analytics-content");
  const icon = $("analytics-toggle-icon");
  if (content.style.display === "none") {
    content.style.display = "block";
    icon.innerHTML = mdiIcon("chevron-up");
    updateAnalytics();
  } else {
    content.style.display = "none";
    icon.innerHTML = mdiIcon("chevron-down");
  }
}

function updateAnalytics() {
  renderBoxTagStats();
  if (!$("analytics-content") || $("analytics-content").style.display === "none") return;
  if (!S.pokemons || !S.pokemons.length) return;

  if (typeof Chart === 'undefined') return;
  const palette = getComputedStyle(document.documentElement);
  const chartText = palette.getPropertyValue('--muted').trim();
  const chartBorder = palette.getPropertyValue('--border2').trim();
  let trash = 0, good = 0, great = 0, excellent = 0, hundo = 0;
  S.pokemons.forEach(p => {
    if (p.hundo || p.iv_pct === 100) hundo++;
    else if (p.iv_pct >= 90) excellent++;
    else if (p.iv_pct >= 80) great++;
    else if (p.iv_pct >= 50) good++;
    else trash++;
  });

  const ivLabels = ["Trash (<50%)", "Average (50-79%)", "Good (80-89%)", "Excellent (90-99%)", "Hundo (100%)"];

  if (chartIvInstance) chartIvInstance.destroy();
  const ctxIv = $("chart-iv").getContext("2d");
  chartIvInstance = new Chart(ctxIv, {
    type: "bar",
    data: {
      labels: ivLabels,
      datasets: [{
        label: "Count",
        data: [trash, good, great, excellent, hundo],
        backgroundColor: [
          "rgba(239, 68, 68, 0.6)",
          "rgba(249, 115, 22, 0.6)",
          "rgba(234, 179, 8, 0.6)",
          "rgba(34, 197, 94, 0.6)",
          "rgba(163, 230, 53, 0.8)"
        ],
        borderColor: [
          "#ef4444", "#f97316", "#eab308", "#22c55e", "#a3e635"
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { color: chartBorder }, ticks: { color: chartText, font: { size: 10 } } },
        y: { grid: { color: chartBorder }, ticks: { color: chartText, font: { size: 10 } } }
      }
    }
  });

  const typesMap = {};
  S.pokemons.forEach(p => {
    const pTypes = p.types || ["normal"];
    pTypes.forEach(t => {
      typesMap[t] = (typesMap[t] || 0) + 1;
    });
  });

  const sortedTypes = Object.entries(typesMap)
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10);

  const typeLabels = sortedTypes.map(x => x[0].toUpperCase());
  const typeValues = sortedTypes.map(x => x[1]);

  if (chartTypesInstance) chartTypesInstance.destroy();
  const ctxTypes = $("chart-types").getContext("2d");
  chartTypesInstance = new Chart(ctxTypes, {
    type: "doughnut",
    data: {
      labels: typeLabels,
      datasets: [{
        data: typeValues,
        backgroundColor: [
          "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
          "#ec4899", "#f43f5e", "#14b8a6", "#6366f1", "#84cc16"
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: chartText, font: { size: 9 } }
        }
      }
    }
  });

  const nandos = S.pokemons.filter(p => p.iv_a === 0 && p.iv_d === 0 && p.iv_s === 0);
  $("nando-list-label").textContent = nandos.length;
  const container = $("nando-names-container");
  container.innerHTML = nandos.map(p => 
    `<span class="badge badge-shadow" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#f87171;" data-tooltip="${p.name} CP${p.cp}">Nando ${p.name} (CP ${p.cp})</span>`
  ).join("") || `<span style="color:var(--muted)">No 0% IV specimens</span>`;
}

async function recalcPowerup(select, idx) {
  const targetLvl = parseFloat(select.value);
  const container = $(`pow-calc-${idx}`);
  if (!targetLvl) {
    container.innerHTML = `<span style="color:var(--muted);font-size:10px">—</span>`;
    return;
  }
  
  const p = S.pokemons[idx];
  container.innerHTML = `<div style="text-align:center;"><div class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></div></div>`;
  
  try {
    const res = await api("/api/powerup-calculation", {
      method: "POST",
      body: JSON.stringify({
        pid: p.pid,
        current_lvl: p.lvl,
        target_lvl: targetLvl,
        iv_a: p.iv_a,
        iv_d: p.iv_d,
        iv_s: p.iv_s,
        shadow: p.shadow,
        lucky: p.lucky,
        purified: p.purified
      })
    });
    
    let xlText = res.xl_candy > 0 ? ` · 💊${res.xl_candy}` : "";
    container.innerHTML = `
      <div style="font-size:10px; line-height:1.3; color:var(--muted);">
        <strong style="color:var(--accent);">CP ${res.target_cp}</strong><br>
        ${gameStatusIcon('stardust')}${res.stardust.toLocaleString("en-US")} · 🍬${res.candy}${xlText}
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<span style="color:var(--red); font-size:10px;">Error</span>`;
  }
}

// Init event listeners for dynamic Regex PoGO and trash filtering
(function initRegexBarEvents() {
  // Bind listeners to all inputs inside regex-bar to dynamically update query and filter results if "trash" is active
  document.addEventListener("input", (e) => {
    if (e.target.closest(".regex-bar input")) {
      updatePogoQuery();
      if (S.filter === "trash") {
        renderPokemons();
      }
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.closest(".regex-bar input")) {
      updatePogoQuery();
      if (S.filter === "trash") {
        renderPokemons();
      }
    }
  });

  // Trash filter button click listener
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-filter-trash");
    if (btn) {
      $("poke-filter").value = "trash";
      S.filter = "trash";
      // Switch tab to "pokemons"
      const tabBtn = document.querySelector('.tab[data-tab="pokemons"]');
      if (tabBtn) {
        tabBtn.click();
      }
      renderPokemons();
      // Scroll to the main table toolbar so the user sees the list
      $("poke-search").scrollIntoView({ behavior: "smooth" });
    }
  });
})();

window.addEventListener("appearancechange", () => updateAnalytics());

const formLabels={mega:'Mega evolution',dynamax:'Dynamax',gigantamax:'Gigantamax',purified:'Purified',costumed:'Costumed',shadow:'Shadow'};
function renderForms() {
  const category=$('forms-filter').value,search=$('forms-search').value.trim().toLowerCase().replace(/^#/,'');
  $('form-categories').innerHTML=Object.entries(formLabels).map(([key,label])=>'<button class="metric-tile '+(category===key?'selected':'')+'" data-form-kind="'+key+'"><span>'+label+'</span><strong>'+S.pokemons.filter(p=>p[key]).length+'</strong></button>').join('');
  const rows=S.pokemons.filter(p=>p[category]&&[p.name,p.species_name,p.nick,p.pid].join(' ').toLowerCase().includes(search));
  $('forms-count').textContent=rows.length+' matching Pokémon';
  $('forms-tbody').innerHTML=rows.map(p=>'<tr><td class="mono">'+dexLabel(p)+'</td><td>'+gameAsset('pokemon',p.species_name||p.name,p.shiny,p)+pokemonIdentity(p)+'</td><td>'+p.cp+'</td><td>'+p.iv_pct+'%</td><td>'+p.lvl+'</td><td>'+statusBadges(p)+(p.shadow?tagBadge('shadow','Shadow'):'')+(p.costume?'<span class="supporting-text">'+escapeHtml(p.costume)+'</span>':'')+'</td></tr>').join('')||'<tr><td colspan="6">No matching exported status. Missing flags are not inferred from species or nickname.</td></tr>';
}
$('forms-filter').addEventListener('change',renderForms);
$('forms-search').addEventListener('input',renderForms);
$('form-categories').addEventListener('click',event=>{const button=event.target.closest('[data-form-kind]');if(button){$('forms-filter').value=button.dataset.formKind;renderForms();}});
window.addEventListener('assetschange',()=>{renderPokemons();renderItems();renderForms();renderBoxTagStats();});
$('tabs').style.display='flex';
$('main-ui').style.display='block';
$('panel-pokemon').hidden=!hasLatestExport;
renderForms();
$('form-diagnostics-load').addEventListener('click',async()=>{
  const target=$('form-diagnostics-output');target.textContent='Loading…';
  try{target.textContent=JSON.stringify(await api('/api/pokemons/form-diagnostics?pid='+encodeURIComponent($('form-diagnostics-pid').value)),null,2);}
  catch(error){target.textContent=error.message;}
});
