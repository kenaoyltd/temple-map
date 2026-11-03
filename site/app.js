(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => n.toLocaleString("ja-JP");

  const [data, meta] = await Promise.all([
    fetch("data/temples.json").then((r) => r.json()),
    fetch("data/sects.json").then((r) => r.json()),
  ]);
  const SECTS = meta.sects;
  const TIERS = meta.tiers;
  const F = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  const rows = data.rows;
  const YSRC = ["", "Wikidata", "Wikipedia本文から推定", "主要寺院リスト"];

  // ---------------- 状態
  const state = {
    sects: new Set(SECTS.map((_, i) => i)),
    tiers: new Set([1, 2, 3, 4]),
    maxYear: 2030,
    unknownYear: true,
    halls: true,
    noname: false,
  };

  // ---------------- 集計
  const sectCount = SECTS.map(() => 0);
  const tierCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of rows) { sectCount[r[F.sect]]++; tierCount[r[F.tier]]++; }
  const st = data.stats;
  $("#summary").textContent = data.region === "サンプル"
    ? `サンプル表示(主要寺院 ${fmt(st.total)} 件)・データ取得前`
    : `${data.region}の寺院 ${fmt(st.total)} 件・${data.generated} 更新`;
  $("#aboutStats").textContent =
    `収録 ${fmt(st.total)} 件のうち、宗派が分かるもの ${fmt(st.sect_known)} 件、創建年が分かるもの ${fmt(st.year_known)} 件、Wikipedia記事があるもの ${fmt(st.wp)} 件。`;

  // ---------------- 地図
  const geo = {
    type: "FeatureCollection",
    features: rows.map((r, i) => ({
      type: "Feature", id: i,
      geometry: { type: "Point", coordinates: [r[F.lon], r[F.lat]] },
      properties: { i, s: r[F.sect], t: r[F.tier], y: r[F.year], k: r[F.kind], n: r[F.name] },
    })),
  };

  const map = new maplibregl.Map({
    localIdeographFontFamily: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
    container: "map",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        gsi: {
          type: "raster", tileSize: 256, maxzoom: 18,
          tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a> | 寺院データ © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>, Wikidata, Wikipedia',
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#f6f1e7" } },
        { id: "gsi", type: "raster", source: "gsi", paint: { "raster-saturation": -0.55, "raster-opacity": 0.9 } },
      ],
    },
    center: [137.5, 37.2], zoom: 4.6, minZoom: 3.5, maxZoom: 18, hash: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.GeolocateControl({}), "top-right");
  map.addControl(new maplibregl.ScaleControl({}), "bottom-right");

  const colorExpr = ["match", ["get", "s"], ...SECTS.flatMap((s, i) => [i, s.color]), "#999"];
  const radius = (t1, t2, t3, t4) => ["match", ["get", "t"], 1, t1, 2, t2, 3, t3, t4];

  map.on("load", () => {
    map.addSource("temples", { type: "geojson", data: geo });
    map.addLayer({
      id: "temples", type: "circle", source: "temples",
      paint: {
        "circle-color": colorExpr,
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          4, radius(6, 4, 2.2, 1.3),
          9, radius(10, 7, 4, 2.8),
          14, radius(14, 11, 8, 6.5)],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.75, 10, 0.95],
        "circle-stroke-color": ["match", ["get", "t"], 1, "#2b2620", 2, "#2b2620", "#ffffff"],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, ["match", ["get", "t"], 1, 1.2, 2, 0.8, 0], 11, ["match", ["get", "t"], 1, 2, 2, 1.5, 0.8]],
      },
    });
    map.addLayer({
      id: "labels", type: "symbol", source: "temples",
      filter: ["<=", ["get", "t"], 2],
      minzoom: 5,
      layout: {
        "text-field": ["get", "n"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 12, 13],
        "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true,
        "text-font": ["Open Sans Regular"],
        "symbol-sort-key": ["get", "t"],
      },
      paint: { "text-color": "#2b2620", "text-halo-color": "#f6f1e7", "text-halo-width": 1.6 },
    });
    map.addLayer({
      id: "labels-all", type: "symbol", source: "temples", minzoom: 14,
      filter: [">", ["get", "t"], 2],
      layout: { "text-field": ["get", "n"], "text-size": 11, "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true, "text-font": ["Open Sans Regular"] },
      paint: { "text-color": "#5f564a", "text-halo-color": "#f6f1e7", "text-halo-width": 1.4 },
    });
    applyFilter();
    if (!location.hash || location.hash.length < 4) {
      // データのある範囲に合わせて表示(外れ値を除くため上下1%を切る)
      const lats = rows.map((r) => r[F.lat]).sort((a, b) => a - b);
      const lons = rows.map((r) => r[F.lon]).sort((a, b) => a - b);
      const q = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
      if (rows.length) map.fitBounds([[q(lons, 0.01), q(lats, 0.01)], [q(lons, 0.99), q(lats, 0.99)]], { padding: 30, duration: 0 });
    }
  });

  for (const l of ["temples"]) {
    map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("click", "temples", (e) => {
    const f = e.features.sort((a, b) => a.properties.t - b.properties.t)[0];
    openPopup(f.properties.i);
  });

  // ---------------- フィルタ
  function passes(r) {
    if (!state.sects.has(r[F.sect]) || !state.tiers.has(r[F.tier])) return false;
    const y = r[F.year];
    if (y ? y > state.maxYear : !state.unknownYear) return false;
    const k = r[F.kind];
    if (k === 1 && !state.halls) return false;
    if (k === 2 && !state.noname) return false;
    return true;
  }
  function applyFilter() {
    const yearExpr = state.unknownYear
      ? ["any", ["==", ["get", "y"], 0], ["<=", ["get", "y"], state.maxYear]]
      : ["all", [">", ["get", "y"], 0], ["<=", ["get", "y"], state.maxYear]];
    const kinds = [0]; if (state.halls) kinds.push(1); if (state.noname) kinds.push(2);
    const filter = ["all",
      ["in", ["get", "s"], ["literal", [...state.sects]]],
      ["in", ["get", "t"], ["literal", [...state.tiers]]],
      yearExpr,
      ["in", ["get", "k"], ["literal", kinds]],
    ];
    if (map.getLayer("temples")) {
      map.setFilter("temples", filter);
      map.setFilter("labels", ["all", filter, ["<=", ["get", "t"], 2]]);
      map.setFilter("labels-all", ["all", filter, [">", ["get", "t"], 2]]);
    }
    let n = 0; for (const r of rows) if (passes(r)) n++;
    $("#visibleCount").textContent = `地図に表示中:${fmt(n)} 件`;
    renderSects(); renderPyramid();
  }

  // ---------------- 宗派リスト
  const maxSect = Math.max(...sectCount);
  function renderSects() {
    $("#sectList").innerHTML = SECTS.map((s, i) => `
      <li data-i="${i}" class="${state.sects.has(i) ? "" : "off"}" title="${esc(s.detail)}">
        <span class="dot" style="background:${s.color}"></span>
        <span style="flex:1">${esc(s.name)}<div class="bar" style="color:${s.color};width:${Math.max(2, (sectCount[i] / maxSect) * 100)}%"></div></span>
        <span class="count">${fmt(sectCount[i])}</span>
      </li>`).join("");
  }
  $("#sectList").addEventListener("click", (e) => {
    const li = e.target.closest("li"); if (!li) return;
    const i = +li.dataset.i;
    if (e.altKey || e.metaKey) { state.sects = new Set([i]); }
    else state.sects.has(i) ? state.sects.delete(i) : state.sects.add(i);
    applyFilter();
  });
  $("#sectAll").onclick = (e) => { e.preventDefault(); state.sects = new Set(SECTS.map((_, i) => i)); applyFilter(); };
  $("#sectNone").onclick = (e) => { e.preventDefault(); state.sects = new Set(); applyFilter(); };

  // ---------------- 寺格ピラミッド
  function renderPyramid() {
    $("#pyramid").innerHTML = TIERS.map((t) => `
      <div class="tier ${state.tiers.has(t.tier) ? "" : "off"}" data-tier="${t.tier}" title="${esc(t.detail)}">
        <b>${esc(t.tier === 4 ? "一般寺院" : t.name.split("・")[0])}</b><span>${fmt(tierCount[t.tier])}</span>
      </div>`).join("");
  }
  $("#pyramid").addEventListener("click", (e) => {
    const el = e.target.closest(".tier"); if (!el) return;
    const t = +el.dataset.tier;
    state.tiers.has(t) ? state.tiers.delete(t) : state.tiers.add(t);
    applyFilter();
  });
  $("#rankInfo").innerHTML = `<p class="muted small">${esc(meta.tier_note)}</p>` + TIERS.map((t) => `
    <div class="rank-card"><h3>${"▲".repeat(5 - t.tier)} ${esc(t.name)}<span class="num">${fmt(tierCount[t.tier])} 件</span></h3><p>${esc(t.detail)}</p></div>`).join("") +
    `<h2 style="margin-top:16px">頂点の寺</h2><ul id="topList" class="sect-list"></ul>`;
  const tops = rows.map((r, i) => [r, i]).filter(([r]) => r[F.tier] === 1).sort((a, b) => a[0][F.sect] - b[0][F.sect]);
  $("#topList").innerHTML = tops.map(([r, i]) => `<li data-idx="${i}"><span class="dot" style="background:${SECTS[r[F.sect]].color}"></span>${esc(r[F.name])}<span class="count">${esc(r[F.branch] || SECTS[r[F.sect]].name)}</span></li>`).join("");
  $("#topList").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) flyTo(+li.dataset.idx); });

  // ---------------- 創建年スライダー
  const yearEl = $("#year");
  function setYear(v) {
    state.maxYear = +v;
    yearEl.value = v;
    $("#yearLabel").textContent = v >= 2030 ? "すべて" : `${v}年まで`;
    applyFilter();
  }
  yearEl.addEventListener("input", () => setYear(yearEl.value));
  $("#showUnknownYear").onchange = (e) => { state.unknownYear = e.target.checked; applyFilter(); };
  $("#showHalls").onchange = (e) => { state.halls = e.target.checked; applyFilter(); };
  $("#showNoname").onchange = (e) => { state.noname = e.target.checked; applyFilter(); };
  let timer = null;
  $("#play").onclick = () => {
    if (timer) { clearInterval(timer); timer = null; $("#play").textContent = "▶"; return; }
    $("#play").textContent = "❚❚";
    state.unknownYear = false; $("#showUnknownYear").checked = false;
    let y = 550;
    setYear(y);
    timer = setInterval(() => {
      y += 20;
      if (y >= 2030) { clearInterval(timer); timer = null; $("#play").textContent = "▶"; y = 2030; }
      setYear(y);
    }, 120);
  };

  // ---------------- 宗派の歴史(年表)
  const tl = SECTS.filter((s) => s.year).sort((a, b) => a.year - b.year);
  $("#timeline").innerHTML = tl.map((s) => {
    const i = SECTS.indexOf(s);
    return `<div class="tl-item" data-i="${i}">
      <span class="tl-year">${s.year}</span><span class="dot" style="background:${s.color}"></span>
      <h3>${esc(s.name)}</h3><div class="tl-founder">${esc(s.founder)}</div>
      <p>${esc(s.event)}</p><div class="tl-count">地図上 ${fmt(sectCount[i])} 件 ・ ${esc(s.detail)}</div></div>`;
  }).join("");
  $("#timeline").addEventListener("click", (e) => {
    const it = e.target.closest(".tl-item"); if (!it) return;
    state.sects = new Set([+it.dataset.i]);
    showTab("filter"); applyFilter();
  });

  // ---------------- タブ・パネル
  function showTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + name));
  }
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $("#panelToggle").onclick = () => $("#panel").classList.add("closed");
  $("#panelOpen").onclick = () => $("#panel").classList.remove("closed");
  if (window.innerWidth <= 760) $("#panel").classList.add("closed");

  // ---------------- 検索
  const searchEl = $("#search");
  const norm = (s) => (s || "").replace(/\s/g, "").replace(/佛/g, "仏").replace(/峯/g, "峰");
  searchEl.addEventListener("input", () => {
    const q = norm(searchEl.value);
    if (q.length < 1) { $("#results").innerHTML = ""; return; }
    const hits = [];
    for (let i = 0; i < rows.length && hits.length < 60; i++) {
      if (norm(rows[i][F.name]).includes(q)) hits.push(i);
    }
    hits.sort((a, b) => rows[a][F.tier] - rows[b][F.tier]);
    $("#results").innerHTML = hits.length
      ? hits.map((i) => { const r = rows[i]; return `<li data-idx="${i}"><span class="dot" style="background:${SECTS[r[F.sect]].color}"></span>${esc(r[F.name])}<span class="muted">${esc(r[F.rank] || r[F.branch] || SECTS[r[F.sect]].name)}</span></li>`; }).join("")
      : `<li class="muted">見つかりませんでした</li>`;
  });
  $("#results").addEventListener("click", (e) => { const li = e.target.closest("li[data-idx]"); if (li) flyTo(+li.dataset.idx); });

  function flyTo(i) {
    const r = rows[i];
    map.flyTo({ center: [r[F.lon], r[F.lat]], zoom: Math.max(map.getZoom(), 15), speed: 1.6 });
    map.once("moveend", () => openPopup(i));
    if (window.innerWidth <= 760) $("#panel").classList.add("closed");
  }

  // ---------------- 詳細ポップアップ
  let popup = null;
  function openPopup(i) {
    const r = rows[i];
    const s = SECTS[r[F.sect]];
    const tier = TIERS.find((t) => t.tier === r[F.tier]);
    const name = r[F.name] || "(名前の登録なし)";
    const rankText = r[F.rank] || (r[F.tier] === 4 ? "一般寺院(寺格不明を含む)" : tier.name);
    const year = r[F.year] ? `${r[F.year]}年` + (r[F.ysrc] === 2 ? "(推定)" : "") : "不明";
    const links = [];
    if (r[F.wp]) links.push(`<a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(r[F.wp])}" target="_blank" rel="noopener">Wikipedia</a>`);
    links.push(`<a href="https://www.google.com/maps/search/?api=1&query=${r[F.lat]},${r[F.lon]}" target="_blank" rel="noopener">Googleマップ</a>`);
    if (r[F.osm]) links.push(`<a href="https://www.openstreetmap.org/${r[F.osm]}" target="_blank" rel="noopener">OSM</a>`);
    if (r[F.wd]) links.push(`<a href="https://www.wikidata.org/wiki/${r[F.wd]}" target="_blank" rel="noopener">Wikidata</a>`);
    const html = `<div class="pop">
      <h3>${esc(name)}</h3>
      <div class="tags">
        <span class="tag sect" style="background:${s.color}">${esc(s.name)}</span>
        <span class="tag">${esc(rankText)}</span>
      </div>
      <dl>
        <dt>宗派</dt><dd>${esc(r[F.branch] || s.name)}</dd>
        <dt>創建</dt><dd>${esc(year)}${r[F.ysrc] ? ` <span class="src">出典:${YSRC[r[F.ysrc]]}</span>` : ""}</dd>
        ${r[F.founder] ? `<dt>開山・開基</dt><dd>${esc(r[F.founder])}</dd>` : ""}
        ${s.year ? `<dt>宗派の成立</dt><dd>${s.year}年頃(${esc(s.founder)})</dd>` : ""}
      </dl>
      ${r[F.wp] ? `<div class="wp" id="wpText">Wikipediaの説明を読み込み中…</div>` : `<p class="src">この寺の詳しい歴史はまだデータに登録されていません。</p>`}
      <div class="plinks">${links.join("")}</div>
    </div>`;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "360px", offset: 10 }).setLngLat([r[F.lon], r[F.lat]]).setHTML(html).addTo(map);
    if (r[F.wp]) {
      fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r[F.wp].replace(/ /g, "_"))}`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((j) => {
          const el = document.getElementById("wpText");
          if (!el) return;
          if (j.type === "disambiguation" || !j.extract) { el.textContent = "Wikipediaに該当する説明が見つかりませんでした。"; return; }
          el.innerHTML = `${esc(j.extract || "")}<div class="src">出典:Wikipedia「${esc(j.title)}」(CC BY-SA)</div>`;
        })
        .catch(() => { const el = document.getElementById("wpText"); if (el) el.textContent = "Wikipediaの説明を取得できませんでした。"; });
    }
  }

  renderSects(); renderPyramid();
})();
