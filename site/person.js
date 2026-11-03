// 歴史上の人物から、ゆかりの寺・神社・城を探す(Wikipedia のリンク関係を利用)
(function () {
  "use strict";
  const WP = "https://ja.wikipedia.org/w/api.php";
  const TYPES = [
    { k: "temple", label: "寺院", tpl: "日本の寺院", color: "#b5352a" },
    { k: "shrine", label: "神社", tpl: "神社", color: "#d97706" },
    { k: "castle", label: "城", tpl: "日本の城郭概要表", color: "#3f4a5a" },
  ];
  const STRONG = /墓所|墓|菩提寺|菩提|霊廟|廟所|廟|位牌|葬|開基|開山|建立|創建|発願|創始|生誕|誕生|生まれ|出生|祀|祭神|築城|居城|最期|自害|没/;
  const api = (q) => fetch(`${WP}?${new URLSearchParams({ ...q, format: "json", formatversion: 2, origin: "*" })}`).then((r) => r.json());

  const start = () => {
    const { map, esc, fmt, openPopup, titleToIdx, rows, F } = window.TM;
    const pane = document.getElementById("pane-person");
    pane.innerHTML = `
      <p class="muted small">歴史上の人物の名前を入れると、その人物にゆかりのある寺・神社・城を全国から探して地図に表示します(Wikipediaの記事どうしのつながりを利用)。</p>
      <form id="psForm" class="ps-form">
        <input id="psInput" list="psList" type="search" placeholder="例:徳川家康、豊臣秀吉、聖徳太子" autocomplete="off">
        <datalist id="psList"></datalist>
        <button>探す</button>
      </form>
      <div class="ps-types">${TYPES.map((t) => `<label class="check"><input type="checkbox" data-k="${t.k}" checked><span class="dot" style="background:${t.color}"></span>${t.label}</label>`).join("")}</div>
      <label class="check"><input type="checkbox" id="psStrongOnly"> ゆかりの深いものだけ表示</label>
      <div id="psStatus" class="muted small ps-status"></div>
      <ul id="psResults" class="ps-results"></ul>`;

    const css = document.createElement("style");
    css.textContent = `.tabs .tab{white-space:nowrap;font-size:12.5px;padding:9px 0}.ps-form{display:flex;gap:6px;margin:8px 0}.ps-form input{flex:1;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:#fffdf8;font:inherit;font-size:14px}
      .ps-form button{border:0;border-radius:6px;background:var(--accent);color:#fff;padding:0 14px;font:inherit;cursor:pointer}
      .ps-types{display:flex;gap:12px;flex-wrap:wrap}.ps-types .dot{margin-right:2px}.ps-status{margin:8px 0}
      .ps-results{list-style:none;margin:0;padding:0}.ps-results li{padding:8px 4px;border-bottom:1px dashed var(--line);cursor:pointer}
      .ps-results li:hover{background:var(--paper-2)}.ps-results b{font-size:13.5px}.ps-results .badge{font-size:10.5px;padding:1px 6px;border-radius:8px;margin-left:6px;color:#fff;vertical-align:1px}
      .ps-results .strong{background:#8e2a21}.ps-results .weak{background:#a59c8f}.ps-results .snip{display:block;font-size:11.5px;color:var(--ink-2);line-height:1.55;margin-top:2px}
      .ps-results .searchmatch,.ps-pop .searchmatch{background:#f3e7c0;color:var(--ink)}.ps-results .nogeo{font-size:10.5px;color:var(--ink-2)}
      .ps-pop h3{font-family:var(--font);font-size:17px;margin:0 0 4px}.ps-pop p{font-size:12.5px;line-height:1.65;margin:6px 0}.ps-pop .plinks{display:flex;gap:10px;font-size:12px}`;
    document.head.appendChild(css);

    map.addSource("person", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "person-pt", type: "circle", source: "person",
      paint: {
        "circle-color": ["match", ["get", "type"], ...TYPES.flatMap((t) => [t.k, t.color]), "#555"],
        "circle-radius": ["case", ["get", "strong"], 9, 6],
        "circle-stroke-color": "#fffdf8", "circle-stroke-width": 2,
      } });
    map.addLayer({ id: "person-label", type: "symbol", source: "person", minzoom: 6,
      layout: { "text-field": ["get", "title"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true, "text-font": ["Open Sans Regular"] },
      paint: { "text-color": "#2b2620", "text-halo-color": "#f6f1e7", "text-halo-width": 1.6 } });

    // 候補(サジェスト)
    let timer = null;
    const input = document.getElementById("psInput");
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const v = input.value.trim();
      if (v.length < 2) return;
      timer = setTimeout(async () => {
        const j = await api({ action: "opensearch", search: v, limit: 8, namespace: 0 }).catch(() => null);
        if (j) document.getElementById("psList").innerHTML = (j[1] || []).map((t) => `<option value="${esc(t)}">`).join("");
      }, 250);
    });

    let results = [];
    const draw = () => {
      const strongOnly = document.getElementById("psStrongOnly").checked;
      const on = new Set([...pane.querySelectorAll(".ps-types input:checked")].map((x) => x.dataset.k));
      const shown = results.filter((r) => on.has(r.type) && (!strongOnly || r.strong));
      map.getSource("person").setData({ type: "FeatureCollection", features: shown.filter((r) => r.lat != null).map((r, i) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { i: results.indexOf(r), type: r.type, strong: r.strong, title: r.title } })) });
      document.getElementById("psResults").innerHTML = shown.map((r) => {
        const t = TYPES.find((x) => x.k === r.type);
        return `<li data-i="${results.indexOf(r)}"><span class="dot" style="background:${t.color};display:inline-block;margin-right:6px"></span><b>${esc(r.title)}</b>` +
          `<span class="badge ${r.strong ? "strong" : "weak"}">${r.strong ? "ゆかり深い" : "関連"}</span>${r.lat == null ? ' <span class="nogeo">(位置情報なし)</span>' : ""}` +
          `<span class="snip">${r.snippet}</span></li>`;
      }).join("");
      return shown;
    };
    pane.querySelectorAll(".ps-types input, #psStrongOnly").forEach((x) => x.addEventListener("change", draw));

    const show = (r) => {
      const t = TYPES.find((x) => x.k === r.type);
      const idx = titleToIdx.get(r.title);
      const html = `<div class="ps-pop"><h3>${esc(r.title)}</h3>
        <span class="muted small">${t.label}・${r.strong ? "ゆかり深い" : "関連"}</span>
        <p>${r.snippet || ""}</p>
        <div class="plinks"><a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(r.title)}" target="_blank" rel="noopener">Wikipedia</a>
        ${r.lat != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}" target="_blank" rel="noopener">Googleマップ</a>` : ""}
        ${idx ? `<a href="#" class="ps-detail" data-idx="${idx[0]}">この寺の詳細</a>` : ""}</div></div>`;
      if (r.lat == null) return;
      map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 13), speed: 1.6 });
      const pop = new maplibregl.Popup({ maxWidth: "340px", offset: 10 }).setLngLat([r.lon, r.lat]).setHTML(html).addTo(map);
      const d = pop.getElement().querySelector(".ps-detail");
      if (d) d.addEventListener("click", (e) => { e.preventDefault(); pop.remove(); openPopup(+d.dataset.idx); });
    };
    document.getElementById("psResults").addEventListener("click", (e) => {
      const li = e.target.closest("li[data-i]"); if (!li) return;
      show(results[+li.dataset.i]);
      if (window.innerWidth <= 760) document.getElementById("panel").classList.add("closed");
    });
    map.on("click", "person-pt", (e) => show(results[e.features[0].properties.i]));
    map.on("mouseenter", "person-pt", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "person-pt", () => (map.getCanvas().style.cursor = ""));

    document.getElementById("psForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      const st = document.getElementById("psStatus");
      if (!q) return;
      st.textContent = "人物の記事を確認中…";
      results = [];
      draw();
      try {
        // 記事名を確定(リダイレクト・表記ゆれを解決)
        const pj = await api({ action: "query", titles: q, redirects: 1, prop: "pageprops" });
        const page = pj.query?.pages?.[0];
        if (!page || page.missing) { st.textContent = `「${q}」というWikipediaの記事が見つかりませんでした。候補から選んでください。`; return; }
        if (page.pageprops && "disambiguation" in page.pageprops) { st.textContent = `「${page.title}」は同名の項目が複数あります。候補から人物名を選んでください。`; return; }
        const title = page.title;
        // 姓を除いた呼び名(例:豊臣秀吉 → 秀吉)も文中の判定に使う
        const base = title.replace(/\s*\(.+\)$/, "");
        const sm = base.match(/^(徳川|豊臣|織田|武田|上杉|北条|足利|源|平|藤原|伊達|毛利|島津|真田|明智|今川|前田|黒田|加藤|石田|浅井|朝倉|新田|楠木|坂上|菅原|直江|井伊|本多|竹中|大谷|細川|長宗我部|最上|佐竹|結城|宇喜多|小早川|吉川|大友|龍造寺)(.{2,3})$/);
        const short = sm ? sm[2] : null;
        st.textContent = `「${title}」にゆかりのある場所を検索中…`;
        const seen = new Map();
        for (const t of TYPES) {
          for (const term of [`"${base}"`, ...(short ? [`"${short}"`] : []), ""]) {
            const j = await api({ action: "query", list: "search", srsearch: `linksto:"${title}" hastemplate:"${t.tpl}" ${term}`.trim(), srlimit: 500, srprop: "snippet", srnamespace: 0 });
            for (const h of j.query?.search || []) {
              if (seen.has(h.title)) continue;
              const text = h.snippet.replace(/<[^>]+>/g, "");
              seen.set(h.title, { title: h.title, type: t.k, snippet: term ? h.snippet.replace(/<(?!\/?span[ >])[^>]*>/g, "") : "",
                strong: !!term && STRONG.test(text) });
            }
          }
        }
        results = [...seen.values()];
        // 位置情報(50件ずつ)
        for (let i = 0; i < results.length; i += 50) {
          const batch = results.slice(i, i + 50);
          const cj = await api({ action: "query", prop: "coordinates", titles: batch.map((r) => r.title).join("|"), colimit: "max" });
          for (const p of cj.query?.pages || []) {
            const r = batch.find((x) => x.title === p.title);
            if (r && p.coordinates) { r.lat = p.coordinates[0].lat; r.lon = p.coordinates[0].lon; }
          }
        }
        results.forEach((r) => { if (r.lat === undefined) r.lat = null; });
        results.sort((a, b) => (b.strong - a.strong) || ((a.lat == null) - (b.lat == null)) || a.title.localeCompare(b.title, "ja"));
        const shown = draw();
        const cnt = (k) => results.filter((r) => r.type === k).length;
        st.innerHTML = `「${esc(title)}」ゆかりの場所:${TYPES.map((t) => `${t.label} ${fmt(cnt(t.k))}`).join("・")}(うち「ゆかり深い」${fmt(results.filter((r) => r.strong).length)})。` +
          `<br>「ゆかり深い」は墓所・菩提寺・開基・生誕などの言葉が記事に出てくるものの目安です。<a href="#" id="psClear">表示を消す</a>`;
        document.getElementById("psClear").onclick = (ev) => { ev.preventDefault(); results = []; draw(); st.textContent = ""; };
        const geo = shown.filter((r) => r.lat != null);
        if (geo.length) {
          const b = new maplibregl.LngLatBounds();
          geo.forEach((r) => b.extend([r.lon, r.lat]));
          map.fitBounds(b, { padding: 60, maxZoom: 12 });
        }
      } catch (err) {
        st.textContent = "検索できませんでした。時間をおいてもう一度お試しください。";
      }
    });
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
