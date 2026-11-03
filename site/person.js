// 歴史上の人物から、ゆかりの寺・神社・城を探す(Wikipedia のリンク関係を利用)
(function () {
  "use strict";
  const WP = "https://ja.wikipedia.org/w/api.php";
  const TYPES = [
    { k: "temple", label: "寺院", tpl: "日本の寺院", color: "#b5352a" },
    { k: "shrine", label: "神社", tpl: "神社", color: "#d97706" },
    { k: "castle", label: "城", tpl: "日本の城郭概要表", color: "#3f4a5a" },
  ];
  const STRONG = /墓所|墓|菩提寺|菩提|霊廟|廟|位牌|葬|開基|建立|創建|発願|生誕|誕生|生まれ|出生|祀|祭神|築城|居城|最期|自害|冥福/;
  // 人物名の前後20字以内に「墓所・菩提寺・開基…」などの言葉があるかで判定する
  const isStrong = (html) => {
    const plain = html.replace(/<span class="searchmatch">/g, "\u0001").replace(/<\/span>/g, "\u0002").replace(/<[^>]+>/g, "");
    let m; const re = /\u0001([^\u0002]*)\u0002/g;
    while ((m = re.exec(plain))) {
      const end = m.index + m[0].length;
      const s0 = plain.lastIndexOf("。", m.index) + 1;            // 同じ文(「。」で区切る)の中だけを見る
      let s1 = plain.indexOf("。", end); if (s1 < 0) s1 = plain.length;
      const win = plain.slice(Math.max(s0, m.index - 20), Math.min(s1, end + 20)).replace(/[\u0001\u0002]/g, "");
      if (STRONG.test(win)) return true;
    }
    return false;
  };
  const api = (q) => fetch(`${WP}?${new URLSearchParams({ ...q, format: "json", formatversion: 2, origin: "*" })}`).then((r) => r.json());

  // ---- あいまい検索(ひらがな・漢字の間違いに対応) ----
  // data/persons.json:[名前, よみ, 生年, 没年, 知名度(他言語版の数), 記事名(名前と違う時), 説明]
  let IDX = null, idxP = null;
  const loadIdx = () => idxP || (idxP = fetch("data/persons.json").then((r) => (r.ok ? r.json() : { rows: [] })).catch(() => ({ rows: [] }))
    .then((j) => (IDX = (j.rows || []).map((r) => {
      const k = kana(r[1] || "");
      const parts = (r[1] || "").split(/[\s・]+/).map(kana).filter(Boolean);
      return { n: r[0], k, given: parts.length > 1 ? parts[parts.length - 1] : "", b: r[2], d: r[3], s: r[4] || 0, t: r[5] || r[0], x: r[6] || "" };
    }))));
  const kana = (s) => String(s).replace(/[\s　・=＝]/g, "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const isKana = (s) => /^[ぁ-ゟー]+$/.test(s);
  const lev = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  };
  function fuzzy(q, limit = 8) {
    if (!IDX) return [];
    const raw = q.replace(/[\s　]/g, "");
    const qk = kana(raw);
    if (!raw) return [];
    const kanaQ = isKana(qk);
    const kanjiPart = raw.replace(/[ぁ-ゟァ-ヺー]/g, "");
    const kanaPart = kana(raw.replace(/[^ぁ-ゟァ-ヺー]/g, ""));
    const out = [];
    for (const p of IDX) {
      let sc = 0;
      if (kanaQ) {
        if (!p.k) continue;
        if (p.k === qk) sc = 100;
        else if (p.k.startsWith(qk) && qk.length >= 2) sc = 80;
        else if (p.given && p.given === qk) sc = 70;
        else if (p.given && p.given.startsWith(qk) && qk.length >= 2) sc = 60;
        else if (qk.length >= 3 && p.k.includes(qk)) sc = 50;
        else if (qk.length >= 4) { const d = lev(qk, p.k, 2); sc = d <= 1 ? 45 : d === 2 ? 30 : 0; }
      } else {
        const n = p.n.replace(/\s/g, "");
        if (n === raw) sc = 100;
        else if (n.startsWith(raw) && raw.length >= 2) sc = 75;
        else if (raw.length >= 2 && n.includes(raw)) sc = 60;
        else if (n.length >= 2 && raw.includes(n)) sc = 50;
        else if (raw.length >= 3 && Math.abs(n.length - raw.length) <= 1) {
          const d = lev(raw, n, 2);
          if (d === 1) sc = 55;
          else if (d === 2 && raw.length >= 4) sc = 35;
          else {
            const common = [...new Set(raw)].filter((c) => n.includes(c)).length;
            if (common / Math.max(raw.length, n.length) >= 0.67) sc = 30;
          }
        }
        if (!sc && kanjiPart && kanaPart && n.includes(kanjiPart) && p.k.includes(kanaPart)) sc = 70; // 「徳川いえやす」など
      }
      if (sc) out.push({ p, sc: sc + Math.min(20, Math.log2(p.s + 1) * 2) });
    }
    out.sort((a, b) => b.sc - a.sc);
    const seen = new Set();
    return out.filter((o) => !seen.has(o.p.t) && seen.add(o.p.t)).slice(0, limit).map((o) => o.p);
  }
  const life = (p) => (p.b != null || p.d != null ? `${p.b ?? "?"}〜${p.d ?? "?"}年` : "");

  const start = () => {
    const { map, esc, fmt, openPopup, titleToIdx, rows, F } = window.TM;
    const pane = document.getElementById("pane-person");
    pane.innerHTML = `
      <p class="muted small">歴史上の人物の名前を入れると、その人物にゆかりのある寺・神社・城を全国から探して地図に表示します(Wikipediaの記事どうしのつながりを利用)。</p>
      <form id="psForm" class="ps-form">
        <input id="psInput" list="psList" type="search" placeholder="例:徳川家康、ひでよし、聖徳太子" autocomplete="off">
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
      .ps-pop h3{font-family:var(--font);font-size:17px;margin:0 0 4px}.ps-pop p{font-size:12.5px;line-height:1.65;margin:6px 0}.ps-pop .plinks{display:flex;gap:10px;font-size:12px}
      .ps-maybe{margin:10px 0 4px;display:flex;flex-direction:column;gap:6px}.ps-maybe-h{font-size:12px;color:var(--ink-2);font-weight:600}
      .ps-chip{display:block;text-align:left;border:1px solid var(--line);background:#fffdf8;border-radius:8px;padding:8px 10px;font:inherit;color:var(--ink);cursor:pointer}
      .ps-chip:hover{border-color:var(--accent)}.ps-chip b{font-size:14px;color:var(--accent)}.ps-chip .yomi{font-size:11.5px;color:var(--ink-2);margin-left:8px}
      .ps-chip .sub{display:block;font-size:11.5px;color:var(--ink-2);margin-top:2px}`;
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
    const warm = () => loadIdx();
    input.addEventListener("focus", warm, { once: true });
    document.querySelector(".map-search input")?.addEventListener("focus", warm, { once: true });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const v = input.value.trim();
      if (v.length < 2) return;
      timer = setTimeout(async () => {
        await loadIdx();
        const fz = fuzzy(v, 8);
        const opts = fz.map((p) => `<option value="${esc(p.t)}" label="${esc([p.k, life(p), p.x].filter(Boolean).join(" ・ "))}">`);
        if (fz.length < 8 && !isKana(kana(v))) {
          const j = await api({ action: "opensearch", search: v, limit: 8, namespace: 0 }).catch(() => null);
          for (const t of j?.[1] || []) if (!fz.some((p) => p.t === t) && opts.length < 10) opts.push(`<option value="${esc(t)}">`);
        }
        document.getElementById("psList").innerHTML = opts.join("");
      }, 200);
    });
    // 「もしかして」候補を表示(押すとその人物で検索)
    const chips = (list, head) => list.length ? `<div class="ps-maybe"><div class="ps-maybe-h">${head}</div>${list.map((p) =>
      `<button type="button" class="ps-chip" data-t="${esc(p.t)}"><b>${esc(p.n)}</b>${p.k ? `<span class="yomi">${esc(p.k)}</span>` : ""}` +
      `<span class="sub">${esc([life(p), p.x].filter(Boolean).join(" ・ "))}</span></button>`).join("")}</div>` : "";
    pane.addEventListener("click", (e) => {
      const c = e.target.closest(".ps-chip[data-t]"); if (!c) return;
      input.value = c.dataset.t;
      const m = document.querySelector(".map-search input"); if (m) m.value = c.dataset.t;
      document.getElementById("psForm").requestSubmit();
    });
    // 索引が使えない時の予備:Wikipedia の検索(表記ゆれ・誤字に強い)
    const wpGuess = async (q) => {
      const j = await api({ action: "query", list: "search", srsearch: q, srlimit: 8, srprop: "snippet", srnamespace: 0 }).catch(() => null);
      const sug = j?.query?.searchinfo?.suggestion;
      const hits = (j?.query?.search || []).map((h) => ({ n: h.title, t: h.title, k: "", x: h.snippet.replace(/<[^>]+>/g, "").slice(0, 24) + "…" }));
      if (sug && !hits.some((h) => h.t === sug)) hits.unshift({ n: sug, t: sug, k: "", x: "" });
      return hits.slice(0, 8);
    };

    let results = [], pendingOthers = null, gen = 0;
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
      document.dispatchEvent(new CustomEvent("person-results", { detail: { n: shown.length } }));
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
      const my = ++gen, stale = () => my !== gen;   // 新しい検索が始まったら古い検索の結果は捨てる
      st.textContent = "人物の記事を確認中…";
      results = [];
      draw();
      try {
        // 記事名を確定(リダイレクト・表記ゆれを解決)
        await loadIdx();
        const kanaQ = isKana(kana(q));
        let cands = fuzzy(q, 8);
        const pj = kanaQ ? null : await api({ action: "query", titles: q, redirects: 1, prop: "pageprops" });
        if (stale()) return;
        const page = pj?.query?.pages?.[0];
        const ng = !page || page.missing || (page.pageprops && "disambiguation" in page.pageprops);
        if (ng) {
          // ひらがな・誤字・同名など → 候補を出す
          const qk = kana(q.replace(/[\s\u3000]/g, ""));
          const exact = kanaQ ? cands.filter((p) => p.k === qk || p.given === qk) : [];
          if (!cands.length) cands = await wpGuess(q);
          if (stale()) return;
          const why = kanaQ ? `「${esc(q)}」の読みに近い人物` : page && !page.missing ? `「${esc(page.title)}」は同名の項目が複数あります` : `「${esc(q)}」という人物は見つかりませんでした`;
          st.innerHTML = cands.length ? `${why}。<b>お探しの方はこちらではありませんか?</b>` : `${why}。名前を変えてお試しください。`;
          document.getElementById("psResults").innerHTML = chips(cands, "もしかして:");
          // 読みがぴったり一致する人物が1人だけなら、そのまま検索する(他の候補は結果の下に表示)
          if (exact.length === 1) {
            pendingOthers = cands.filter((p) => p !== exact[0]).slice(0, 5);
            input.value = exact[0].t; document.getElementById("psForm").requestSubmit();
          }
          return;
        }
        const title = page.title;
        const others = (pendingOthers || cands).filter((p) => p.t !== title && p.n !== title).slice(0, 5);
        pendingOthers = null;
        // 姓を除いた呼び名(例:豊臣秀吉 → 秀吉)も文中の判定に使う
        const base = title.replace(/\s*\(.+\)$/, "");
        const sm = base.match(/^(徳川|豊臣|織田|武田|上杉|北条|足利|源|平|藤原|伊達|毛利|島津|真田|明智|今川|前田|黒田|加藤|石田|浅井|朝倉|新田|楠木|坂上|菅原|直江|井伊|本多|竹中|大谷|細川|長宗我部|最上|佐竹|結城|宇喜多|小早川|吉川|大友|龍造寺)(.{2,3})$/);
        const short = sm ? sm[2] : null;
        st.textContent = `「${title}」にゆかりのある場所を検索中…`;
        const seen = new Map();
        // 検索はまとめて同時に送る(速くするため)。結果は決まった順番で取り込む
        const jobs = TYPES.flatMap((t) => [`"${base}"`, ...(short ? [`"${short}"`] : []), ""].map((term) => ({ t, term })));
        const answers = await Promise.all(jobs.map(({ t, term }) =>
          api({ action: "query", list: "search", srsearch: `linksto:"${title}" hastemplate:"${t.tpl}" ${term}`.trim(), srlimit: 500, srprop: "snippet", srnamespace: 0 }).catch(() => ({}))));
        if (stale()) return;
        for (let ji = 0; ji < jobs.length; ji++) {
          const { t, term } = jobs[ji], j = answers[ji];
          {
            for (const h of j.query?.search || []) {
              if (seen.has(h.title)) continue;
              seen.set(h.title, { title: h.title, type: t.k, rank: seen.size, snippet: term ? h.snippet.replace(/<(?!\/?span[ >])[^>]*>/g, "") : "",
                strong: !!term && isStrong(h.snippet) });
            }
          }
        }
        const found = [...seen.values()];
        // 位置情報(50件ずつ、同時に)
        const batches = [];
        for (let i = 0; i < found.length; i += 50) batches.push(found.slice(i, i + 50));
        const coords = await Promise.all(batches.map((batch) =>
          api({ action: "query", prop: "coordinates", titles: batch.map((r) => r.title).join("|"), colimit: "max" }).catch(() => ({}))));
        if (stale()) return;
        batches.forEach((batch, bi) => {
          for (const p of coords[bi].query?.pages || []) {
            const r = batch.find((x) => x.title === p.title);
            if (r && p.coordinates) { r.lat = p.coordinates[0].lat; r.lon = p.coordinates[0].lon; }
          }
        });
        results = found;
        results.forEach((r) => { if (r.lat === undefined) r.lat = null; });
        results.sort((a, b) => (b.strong - a.strong) || ((a.lat == null) - (b.lat == null)) || (a.rank - b.rank));
        const shown = draw();
        const cnt = (k) => results.filter((r) => r.type === k).length;
        st.innerHTML = `「${esc(title)}」ゆかりの場所:${TYPES.map((t) => `${t.label} ${fmt(cnt(t.k))}`).join("・")}(うち「ゆかり深い」${fmt(results.filter((r) => r.strong).length)})。` +
          `<br><a href="#" class="pname" data-name="${esc(title)}">${esc(title)}の人物紹介・家系図</a> ・ <a href="#" id="psClear">表示を消す</a>` +
          `<br>「ゆかり深い」は墓所・菩提寺・開基・生誕などの言葉が記事に出てくるものの目安です。` +
          chips(others, "別の人物をお探しですか?");
        document.getElementById("psClear").onclick = (ev) => { ev.preventDefault(); gen++; results = []; draw(); st.textContent = ""; };
        const geo = shown.filter((r) => r.lat != null);
        if (geo.length) {
          const b = new maplibregl.LngLatBounds();
          geo.forEach((r) => b.extend([r.lon, r.lat]));
          map.fitBounds(b, { padding: 60, maxZoom: 12 });
        }
      } catch (err) {
        if (!stale()) st.textContent = "検索できませんでした。時間をおいてもう一度お試しください。";
      }
    });
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
