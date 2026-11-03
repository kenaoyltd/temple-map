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
  rows.forEach((r, i) => { r.__i = i; });
  const YSRC = ["", "Wikidata", "Wikipedia本文から推定", "主要寺院リスト", "Wikipedia情報欄"];
  const HAS = (k) => F[k] !== undefined;
  const val = (r, k) => (HAS(k) ? r[F[k]] : "");
  const FLAGS = [["札所", "霊場の札所"], ["国宝", "国宝あり"], ["重文", "重要文化財あり"], ["指定文化財", "県・市町村指定文化財"], ["門跡・勅願", "門跡・勅願寺"], ["無住", "無住の記述あり"]];

  // ---------------- 状態
  const state = {
    sects: new Set(SECTS.map((_, i) => i)),
    tiers: new Set([1, 2, 3, 4]),
    maxYear: 2030,
    unknownYear: true,
    halls: true,
    noname: false,
    flags: new Set(),
    kw: null,
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
      properties: { i, s: r[F.sect], t: r[F.tier], y: r[F.year], k: r[F.kind], n: r[F.name], fl: val(r, "flags") || "" },
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
        "circle-stroke-color": ["case", ["<=", ["get", "t"], 2], "#2b2620", ["!=", ["get", "fl"], ""], "#c9a227", "#ffffff"],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["==", ["get", "t"], 1], 1.2, ["==", ["get", "t"], 2], 0.8, ["!=", ["get", "fl"], ""], 1, 0], 11, ["case", ["==", ["get", "t"], 1], 2, ["==", ["get", "t"], 2], 1.5, ["!=", ["get", "fl"], ""], 2.2, 0.8]],
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
    window.TM = { map, rows, F, SECTS, openPopup, flyTo, titleToIdx, esc, fmt };
    document.dispatchEvent(new Event("tm-ready"));
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
    if (state.kw && !state.kw.has(r.__i)) return false;
    if (state.flags.size) { const fl = val(r, "flags") || ""; if (![...state.flags].some((f) => fl.includes("|" + f + "|"))) return false; }
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
    if (state.kw) filter.push(["in", ["get", "i"], ["literal", [...state.kw]]]);
    if (state.flags.size) filter.push(["any", ...[...state.flags].map((f) => ["in", "|" + f + "|", ["get", "fl"]])]);
    if (map.getLayer("temples")) {
      map.setFilter("temples", filter);
      map.setFilter("labels", ["all", filter, ["<=", ["get", "t"], 2]]);
      map.setFilter("labels-all", ["all", filter, [">", ["get", "t"], 2]]);
    }
    let n = 0; for (const r of rows) if (passes(r)) n++;
    $("#visibleCount").textContent = `地図に表示中:${fmt(n)} 件`;
    renderSects(); renderPyramid(); renderFlags();
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
  // ---------------- 格式タグ(札所・文化財など)
  const flagCount = Object.fromEntries(FLAGS.map(([k]) => [k, 0]));
  for (const r of rows) { const fl = val(r, "flags") || ""; for (const [k] of FLAGS) if (fl.includes("|" + k + "|")) flagCount[k]++; }
  const flagBlock = document.createElement("div");
  flagBlock.className = "block";
  flagBlock.innerHTML = `<div class="block-head"><h2>格式</h2><span class="muted small">選ぶと該当する寺だけ表示</span></div><div id="flagChips" class="chips"></div>`;
  $("#pyramid").closest(".block").after(flagBlock);
  function renderFlags() {
    $("#flagChips").innerHTML = FLAGS.map(([k, label]) =>
      `<button class="chip ${state.flags.has(k) ? "on" : ""}" data-k="${k}" ${flagCount[k] ? "" : "disabled"}>${esc(label)}<span>${fmt(flagCount[k])}</span></button>`).join("");
  }
  $("#flagChips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b || b.disabled) return;
    const k = b.dataset.k;
    state.flags.has(k) ? state.flags.delete(k) : state.flags.add(k);
    applyFilter();
  });
  const chipCss = document.createElement("style");
  chipCss.textContent = `.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);background:#fffdf8;border-radius:16px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;color:var(--ink);display:inline-flex;gap:6px;align-items:center}.chip span{color:var(--ink-2);font-size:11px}.chip.on{background:#c9a227;border-color:#c9a227;color:#fff}.chip.on span{color:#fff}.chip:disabled{opacity:.4;cursor:default}.pop .tag.flag{background:#f3e7c0;color:#6b5310}`;
  document.head.appendChild(chipCss);

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

  // ---------------- 歴史(Wikipedia の節)と国立国会図書館の資料
  const WP = "https://ja.wikipedia.org/w/api.php";
  const HIST_RE = /歴史|沿革|由緒|由来|縁起|伝説|伝承|逸話|話|エピソード|創建|開山|ゆかり|縁/;
  const SKIP_RE = /脚注|注釈|出典|参考|関連|外部|交通|アクセス|所在地|周辺|境内|文化財|画像|ギャラリー|行事|年中/;
  const htmlToText = (html) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("sup, .mw-editsection, table, style, .reflist, .mw-references-wrap, figure, .thumb, .gallery, .noprint").forEach((n) => n.remove());
    return [...div.querySelectorAll("p, li")].map((n) => n.textContent.trim()).filter(Boolean).join("\n");
  };
  async function loadHistory(title) {
    const u = (q) => `${WP}?${new URLSearchParams({ ...q, format: "json", formatversion: 2, origin: "*" })}`;
    const sec = await fetch(u({ action: "parse", page: title, prop: "sections", redirects: 1 })).then((x) => x.json());
    const picks = (sec.parse?.sections || []).filter((x) => x.toclevel <= 2 && HIST_RE.test(x.line) && !SKIP_RE.test(x.line)).slice(0, 4);
    if (!picks.length) return `<p class="src">この記事には歴史・伝説の節がありません。<a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank" rel="noopener">記事を開く</a></p>`;
    const parts = await Promise.all(picks.map((x) => fetch(u({ action: "parse", page: title, section: x.index, prop: "text", redirects: 1, disabletoc: 1 }))
      .then((y) => y.json()).then((j) => [x.line.replace(/<[^>]+>/g, ""), htmlToText(j.parse?.text || "")])));
    const anchor = `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    return parts.filter(([, t]) => t).map(([h, t]) => `<h4>${esc(h)}</h4><p class="hist">${esc(t.length > 900 ? t.slice(0, 900) + "…" : t).replace(/\n/g, "<br>")}</p>`).join("") +
      `<p class="src">出典:<a href="${anchor}" target="_blank" rel="noopener">Wikipedia「${esc(title)}」</a>(CC BY-SA 4.0)。全文は記事でご覧ください。</p>`;
  }
  async function loadNdl(name, addr) {
    const city = ((addr || "").match(/(?:都|道|府|県)?([^都道府県]{1,6}?(?:市|町|村|区))/) || [])[1] || "";
    const tryQ = async (q) => {
      const x = await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?any=${encodeURIComponent(q)}&cnt=12`).then((y) => y.text());
      const doc = new DOMParser().parseFromString(x, "text/xml");
      return { q, total: +(doc.getElementsByTagName("openSearch:totalResults")[0]?.textContent || 0), items: [...doc.getElementsByTagName("item")] };
    };
    let res = city ? await tryQ(`${name} ${city}`) : null;
    if (!res || res.total === 0) res = await tryQ(name);
    const g = (it, tag) => it.getElementsByTagName(tag)[0]?.textContent || "";
    const more = `https://ndlsearch.ndl.go.jp/search?cs=bib&keyword=${encodeURIComponent(res.q)}`;
    if (!res.items.length) return `<p class="src">見つかりませんでした。</p>`;
    return `<ul class="ndl">${res.items.map((it) => `<li><a href="${esc(g(it, "link"))}" target="_blank" rel="noopener">${esc(g(it, "title"))}</a>` +
      `<span class="src">${esc([g(it, "dc:publisher"), g(it, "dcterms:issued")].filter(Boolean).join("・"))}</span></li>`).join("")}</ul>` +
      `<p class="src">「${esc(res.q)}」の検索結果 ${fmt(res.total)} 件(国立国会図書館サーチ)。同名の別の寺の資料が混ざることがあります。<a href="${more}" target="_blank" rel="noopener">すべて見る</a></p>`;
  }

  // ---------------- 人物・伝説・キーワードで探す
  const titleToIdx = new Map();
  rows.forEach((r, i) => { if (r[F.wp]) { const a = titleToIdx.get(r[F.wp]) || []; a.push(i); titleToIdx.set(r[F.wp], a); } });
  const kwBlock = document.createElement("div");
  kwBlock.className = "kw";
  kwBlock.innerHTML = `<form id="kwForm"><input id="kw" type="search" placeholder="人物・伝説で探す(例:新田義貞、狸、上杉謙信)" autocomplete="off"><button>探す</button></form><div id="kwStatus" class="muted small"></div><ul id="kwResults"></ul>`;
  $(".search").after(kwBlock);
  $("#kwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#kw").value.trim();
    if (!q) { state.kw = null; $("#kwStatus").textContent = ""; $("#kwResults").innerHTML = ""; applyFilter(); return; }
    $("#kwStatus").textContent = "Wikipediaを検索中…";
    try {
      const p = new URLSearchParams({ action: "query", list: "search", srsearch: `hastemplate:"日本の寺院" "${q}"`, srlimit: 500, srprop: "snippet", format: "json", formatversion: 2, origin: "*" });
      const j = await fetch(`${WP}?${p}`).then((x) => x.json());
      const hits = (j.query?.search || []).filter((h) => titleToIdx.has(h.title));
      state.kw = new Set(hits.flatMap((h) => titleToIdx.get(h.title)));
      $("#kwStatus").innerHTML = `「${esc(q)}」が記事に出てくる寺:この地図に ${fmt(state.kw.size)} 件(全国の記事では ${fmt(j.query?.searchinfo?.totalhits || 0)} 件) <a href="#" id="kwClear">解除</a>`;
      $("#kwResults").innerHTML = hits.slice(0, 40).map((h) => `<li data-idx="${titleToIdx.get(h.title)[0]}"><b>${esc(h.title)}</b><span class="snip">${h.snippet.replace(/<(?!\/?span[ >])[^>]*>/g, "")}</span></li>`).join("");
      $("#kwClear").onclick = (ev) => { ev.preventDefault(); $("#kw").value = ""; $("#kwForm").requestSubmit(); };
      applyFilter();
    } catch (err) { $("#kwStatus").textContent = "検索できませんでした。"; }
  });
  $("#kwResults").addEventListener("click", (e) => { const li = e.target.closest("li[data-idx]"); if (li) flyTo(+li.dataset.idx); });
  const kwCss = document.createElement("style");
  kwCss.textContent = `.kw{margin-top:8px}.kw form{display:flex;gap:6px}.kw input{flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:#fffdf8;font:inherit;font-size:13px}.kw button{border:0;border-radius:6px;background:var(--accent);color:#fff;padding:0 12px;font:inherit;font-size:13px;cursor:pointer}#kwStatus{margin-top:4px}#kwResults{list-style:none;margin:4px 0 0;padding:0;max-height:240px;overflow:auto}#kwResults li{padding:6px 4px;border-bottom:1px dashed var(--line);cursor:pointer;font-size:12.5px}#kwResults li:hover{background:var(--paper-2)}#kwResults .snip{display:block;color:var(--ink-2);font-size:11.5px;line-height:1.5}#kwResults .searchmatch{background:#f3e7c0;color:var(--ink)}.pop{max-height:62vh;overflow-y:auto}.pop details.more{border-top:1px dashed var(--line);padding:6px 0}.pop details.more summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--accent)}.pop .more-body{font-size:12.5px;line-height:1.7;margin-top:6px}.pop .more-body h4{font-size:13px;margin:8px 0 2px;font-family:var(--font)}.pop .hist{margin:0}.pop ul.ndl{margin:0;padding-left:18px}.pop ul.ndl li{margin-bottom:4px}.pop ul.ndl .src{display:block}`;
  document.head.appendChild(kwCss);

  // 人物名を押すと人物カード(家系図)を開けるようにする
  const personLinks = (txt) => esc(txt).split("、").map((part) => {
    const m = part.match(/^((?:開山|開基|中興)\s*)?(.+)$/);
    const nm = (m[2] || "").replace(/[(（][^)）]*[)）]/g, "").trim();
    return nm && !/不明|不詳|^伝$/.test(nm) ? `${m[1] || ""}<a href="#" class="pname" data-name="${nm}">${m[2]}</a>` : part;
  }).join("、");

  // ---------------- 詳細ポップアップ
  let popup = null;
  function openPopup(i) {
    const r = rows[i];
    const s = SECTS[r[F.sect]];
    const tier = TIERS.find((t) => t.tier === r[F.tier]);
    const name = r[F.name] || "(名前の登録なし)";
    const rankText = r[F.rank] || (r[F.tier] === 4 ? "一般寺院(寺格不明を含む)" : tier.name);
    const yt = val(r, "ytext");
    const legend = val(r, "legend") ? "(伝承)" : "";
    let year = r[F.year] ? `${r[F.year]}年` + (r[F.ysrc] === 2 ? "(推定)" : "") + legend : "不明";
    if (yt && !/^\d{3,4}年$/.test(yt)) year = !r[F.year] ? yt : yt.includes(r[F.year] + "年") ? yt + legend : `${yt} → 西暦${r[F.year]}年頃${legend}`;
    const flags = (val(r, "flags") || "").split("|").filter(Boolean);
    const FLAG_LABEL = Object.fromEntries(FLAGS);
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
        ${flags.map((f) => `<span class="tag flag">${esc(FLAG_LABEL[f] || f)}</span>`).join("")}
      </div>
      <dl>
        ${val(r, "sango") ? `<dt>山号</dt><dd>${esc(val(r, "sango"))}</dd>` : ""}
        <dt>宗派</dt><dd>${esc(r[F.branch] || s.name)}</dd>
        <dt>寺格</dt><dd>${esc(rankText)}</dd>
        ${val(r, "honzon") ? `<dt>本尊</dt><dd>${esc(val(r, "honzon"))}</dd>` : ""}
        <dt>創建</dt><dd>${esc(year)}${r[F.ysrc] ? ` <span class="src">出典:${YSRC[r[F.ysrc]]}</span>` : ""}</dd>
        ${r[F.founder] ? `<dt>開山・開基</dt><dd>${personLinks(r[F.founder])}</dd>` : ""}
        ${val(r, "chuko") ? `<dt>中興</dt><dd>${esc(val(r, "chuko"))}</dd>` : ""}
        ${val(r, "fuda") ? `<dt>札所</dt><dd>${esc(val(r, "fuda"))}</dd>` : ""}
        ${val(r, "bunka") ? `<dt>文化財</dt><dd>${esc(val(r, "bunka"))}</dd>` : ""}
        ${val(r, "addr") ? `<dt>所在地</dt><dd>${esc(val(r, "addr"))}</dd>` : ""}
        ${val(r, "tel") ? `<dt>電話</dt><dd><a href="tel:${esc(val(r, "tel").replace(/[^0-9+]/g, ""))}">${esc(val(r, "tel"))}</a></dd>` : ""}
        ${val(r, "web") ? `<dt>公式サイト</dt><dd><a href="${esc(val(r, "web"))}" target="_blank" rel="noopener">${esc(val(r, "web").replace(/^https?:\/\//, "").slice(0, 40))}</a></dd>` : ""}
        ${s.year ? `<dt>宗派の成立</dt><dd>${s.year}年頃(${esc(s.founder)})</dd>` : ""}
      </dl>
      ${r[F.wp] ? `<div class="wp" id="wpText">Wikipediaの説明を読み込み中…</div>` : `<p class="src">この寺の詳しい歴史はまだデータに登録されていません。</p>`}
      ${r[F.wp] ? `<details class="more" data-kind="hist"><summary>歴史・由来・伝説(Wikipedia)</summary><div class="more-body">読み込み中…</div></details>` : ""}
      ${name && r[F.kind] !== 2 ? `<details class="more" data-kind="ndl"><summary>国立国会図書館の関連資料</summary><div class="more-body">読み込み中…</div></details>` : ""}
      ${flags.includes("無住") ? `<p class="src">※「無住」はWikipedia等に記述があることを示す目安です。過去の時期の記述の場合もあります。</p>` : ""}
      <div class="plinks">${links.join("")}</div>
    </div>`;
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ maxWidth: "380px", offset: 10 }).setLngLat([r[F.lon], r[F.lat]]).setHTML(html).addTo(map);
    popup.getElement().querySelectorAll("details.more").forEach((d) => d.addEventListener("toggle", () => {
      if (!d.open || d.dataset.loaded) return;
      d.dataset.loaded = "1";
      const body = d.querySelector(".more-body");
      (d.dataset.kind === "hist" ? loadHistory(r[F.wp]) : loadNdl(name, val(r, "addr")))
        .then((h) => { body.innerHTML = h; })
        .catch(() => { body.textContent = "読み込めませんでした。時間をおいて開き直してください。"; });
    }));
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

  renderSects(); renderPyramid(); renderFlags();
})();
