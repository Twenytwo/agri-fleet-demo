(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const COLORS = ['#1d6fd1', '#d1491d', '#7b3fb3', '#14867a', '#b8860b', '#c2185b'];
  const colorOf = (d) => COLORS[((parseInt((/(\d+)$/.exec(d) || [0, 1])[1], 10) || 1) - 1) % COLORS.length];
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') n.className = v; else n.setAttribute(k, v); });
    kids.flat().forEach((k) => n.append(k instanceof Node ? k : document.createTextNode(k == null ? '' : String(k))));
    return n;
  };
  const fmt = (v, d = 1, u = '') => (v == null || Number.isNaN(Number(v)) ? 'n.d.' : Number(v).toFixed(d) + u);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const card = (k, v) => el('div', { class: 'card' }, el('b', {}, k), v);

  const STATE = {
    running: 'volo in corso', returning_to_launch: 'rientro in corso', completed: 'volo completato',
    mission_finished: 'missione finita', withdrawn_by_operator: 'ritirata da operatore',
    failed: 'volo fallito', cancelled: 'volo annullato', not_started: 'nessun volo',
  };

  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; contributori <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  let data, frames = [], idx = 0, playing = false, speed = 1, acc = 0, last = 0;
  const markers = {}, trails = {}, trailPts = {};
  let auditItems = [];

  function recKey(o, names) { for (const n of names) if (o && o[n] != null) return o[n]; return null; }

  function drawStatic() {
    const gj = data.plan && data.plan.geojson;
    const grp = L.featureGroup().addTo(map);
    if (data.field && data.field.boundary) {
      L.geoJSON(data.field.boundary, { style: { color: '#2f7d4f', weight: 2, fillOpacity: 0.06, dashArray: '4 4' } }).addTo(grp);
    }
    (data.no_fly || []).forEach((z) => L.geoJSON(z, { style: { color: '#b3261e', weight: 2, fillOpacity: 0.2 } }).bindTooltip('Zona vietata').addTo(grp));
    ((data.field && data.field.no_fly_zones) || []).forEach((z) => L.geoJSON(z, { style: { color: '#b3261e', weight: 2, fillOpacity: 0.2 } }).bindTooltip('Zona vietata').addTo(grp));
    if (gj) L.geoJSON(gj, { style: (f) => (f.geometry.type === 'LineString' ? { color: '#6b6b6b', weight: 2, opacity: 0.7 } : { color: '#2f7d4f', weight: 2, fillOpacity: 0.04 }) }).addTo(grp);
    const wps = (data.plan && data.plan.waypoints) || {};
    Object.entries(wps).forEach(([d, pts]) => {
      L.polyline(pts.map((p) => [p.latitude_deg, p.longitude_deg]), { color: colorOf(d), weight: 2, dashArray: '6 4', opacity: 0.8 })
        .bindTooltip(`${d} - rotta pianificata`).addTo(grp);
    });
    const b = grp.getBounds();
    map.invalidateSize();
    map.fitBounds(b.isValid() ? b.pad(0.1) : [[47.3981, 8.5463], [47.3985, 8.5469]], { maxZoom: 19 });
  }

  function ensureDrone(d, ll) {
    if (markers[d]) return;
    const label = (/(\d+)$/.exec(d) || [0, d])[1];
    const icon = L.divIcon({ className: '', html: `<div class="drone-dot" style="background:${colorOf(d)}">${label}</div>`, iconSize: [26, 26] });
    markers[d] = L.marker(ll, { icon, zIndexOffset: 1000 }).addTo(map);
    trails[d] = L.polyline([], { color: colorOf(d), weight: 3 }).addTo(map);
    trailPts[d] = [];
  }

  function buildTrails() {
    // posizioni cumulative per ogni drone, indicizzate sul frame
    const cum = {};
    frames.forEach((f, i) => {
      Object.entries(f.vehicles || {}).forEach(([d, v]) => {
        if (!v.position) return;
        (cum[d] = cum[d] || []).push([i, [v.position.latitude_deg, v.position.longitude_deg]]);
      });
    });
    return cum;
  }
  let cum = {};

  function render(i) {
    idx = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[idx];
    $('#scrub').value = idx;
    $('#clock').textContent = `${mmss(f.t)} / ${mmss(frames[frames.length - 1].t)}`;
    // droni + scie
    Object.entries(cum).forEach(([d, pts]) => {
      let n = 0;
      while (n < pts.length && pts[n][0] <= idx) n++;
      if (n === 0) { if (markers[d]) { map.removeLayer(markers[d]); map.removeLayer(trails[d]); delete markers[d]; delete trails[d]; } return; }
      const ll = pts[n - 1][1];
      ensureDrone(d, ll);
      markers[d].setLatLng(ll);
      trails[d].setLatLngs(pts.slice(0, n).map((p) => p[1]));
      const v = (f.vehicles || {})[d];
      markers[d].bindTooltip(`${d} - ${fmt(v && v.position && v.position.relative_altitude_m, 1, ' m')}`);
    });
    // stato
    $('#runstate').replaceChildren(
      card('Stato volo', STATE[f.state] || f.state || 'n.d.'),
      card('Stato missione', f.mission_state || 'n.d.'),
      card('Separazione minima', f.min_separation_m == null ? 'n.d.' : `${fmt(f.min_separation_m, 1)} m`),
      card('Tempo', mmss(f.t)));
    // droni
    const rows = Object.entries(f.vehicles || {}).map(([d, v]) => el('tr', {},
      el('td', {}, el('span', { class: 'dot', style: `background:${colorOf(d)}` }), d),
      el('td', {}, (v.mode || 'n.d.') + (v.armed === false ? ' (disarmato)' : '')),
      el('td', {}, v.position ? fmt(v.position.relative_altitude_m, 1, ' m') : 'n.d.'),
      el('td', {}, v.battery_percent == null ? 'n.d.' : fmt(v.battery_percent, 0, '%'))));
    $('#vehicles').replaceChildren(rows.length
      ? el('table', {}, el('thead', {}, el('tr', {}, ['Drone', 'Modo', 'Quota', 'Batteria'].map((t) => el('th', {}, t)))), el('tbody', {}, rows))
      : el('span', { class: 'muted' }, 'nessun drone collegato'));
    // avanzamento
    const segs = Object.entries(f.segments || {});
    $('#progress').replaceChildren(...(segs.length ? segs.map(([d, s]) => {
      const pct = s.total ? Math.round((100 * s.done) / s.total) : 0;
      const bar = el('div', { class: 'bar' }, el('span', {}));
      bar.firstChild.style.width = pct + '%';
      return el('div', { class: 'seg' }, el('span', {}, d), bar, el('span', {}, `${s.done}/${s.total}`));
    }) : [el('span', { class: 'muted' }, 'n.d.')]));
    // audit: mostra i record fino al tempo corrente
    const upto = frames[0].abs + f.t + 0.5;
    auditItems.forEach((it) => it.node.classList.toggle('future', it.ts != null && it.ts > upto));
  }

  function renderCoverage() {
    const c = data.coverage || {};
    const g = c.geometric || {};
    const pct = g.ratio == null ? 'n.d.' : fmt(g.ratio * 100, 1, '%');
    const bar = el('div', { class: 'bar' }, el('span', {}));
    bar.firstChild.style.width = (g.ratio == null ? 0 : Math.min(100, g.ratio * 100)) + '%';
    $('#coverage').replaceChildren(
      card('Copertura geometrica', pct), card('Stato', g.status || c.state || 'n.d.'),
      card('Percorso pianificato', fmt(g.planned_treatment_m, 0, ' m')), card('Percorso coperto', fmt(g.covered_treatment_m, 0, ' m')),
      card('Sovrapposizione', fmt(g.overlap_m, 0, ' m')), card('Prova di trattamento', 'NO: solo traccia geometrica'));
    $('#coverage').after(el('p', { class: 'muted' }, 'Informazione indicativa dalla traccia in simulazione: non prova che il campo sia stato trattato.'));
  }

  function renderAudit() {
    const recs = (data.audit && data.audit.records) || [];
    const list = $('#audit');
    list.replaceChildren();
    recs.forEach((r) => {
      const p = Date.parse(r.occurred_at);
      const ts = Number.isNaN(p) ? null : p / 1000;
      const txt = [r.event_type, r.actor ? `(${r.actor})` : '', r.drone_id || '', r.new_state ? `-> ${r.new_state}` : '', r.reason || ''].filter(Boolean).join(' ');
      const node = el('li', {}, ts != null ? el('time', {}, new Date(ts * 1000).toLocaleTimeString('it-IT')) : '', txt.slice(0, 280));
      list.append(node);
      auditItems.push({ ts, node });
    });
    if (!recs.length) list.append(el('li', {}, 'nessun record'));
    const firstTs = auditItems.length && auditItems[0].ts;
    frames[0].abs = firstTs ? firstTs + 1 : 0;
  }

  function tick(now) {
    if (playing) {
      if (last) acc += ((now - last) / 1000) * speed;
      last = now;
      const step = Math.floor(acc);
      if (step >= 1) { acc -= step; render(idx + step); }
      if (idx >= frames.length - 1) setPlaying(false);
    }
    requestAnimationFrame(tick);
  }
  function setPlaying(p) {
    playing = p; last = 0;
    $('#play').textContent = p ? 'Pausa' : 'Play';
    $('#play').setAttribute('aria-label', p ? 'Pausa' : 'Riproduci');
  }

  fetch('flight.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
    data = d; frames = d.frames || [];
    if (!frames.length) { $('#meta').textContent = 'Nessun frame nel replay.'; return; }
    // ancora temporale per l'audit: primo timestamp audit meno tempo frame (se il file lo fornisce)
    cum = buildTrails();
    $('#meta').textContent = `Volo SITL registrato: ${frames.length} campioni, ${mmss(frames[frames.length - 1].t)} di volo, ${Object.keys(frames[0].vehicles || {}).length || Object.keys(cum).length} droni.`;
    drawStatic(); renderCoverage(); renderAudit();
    $('#scrub').max = frames.length - 1;
    render(0);
    requestAnimationFrame(tick);
  }).catch((e) => { $('#meta').textContent = 'Impossibile caricare il replay: ' + e.message; });

  $('#play').addEventListener('click', () => { if (idx >= frames.length - 1) render(0); setPlaying(!playing); });
  $('#restart').addEventListener('click', () => { render(0); });
  $('#scrub').addEventListener('input', (e) => { acc = 0; render(Number(e.target.value)); });
  document.querySelectorAll('.speed').forEach((b) => b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('.speed').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
})();
