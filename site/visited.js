// 参拝記録(行った寺に印をつけて、制覇状況を見る)
// 記録はこのブラウザの中(localStorage)だけに保存し、どこにも送信しない。
(function () {
  "use strict";
  const KEY = "tm.visited.v1";
  const MAX_ITEMS = 20000, MAX_MEMO = 200, MAX_FILE = 2 * 1024 * 1024;

  // ---------- 保存と読み込み(壊れたデータ・容量オーバーでも動くように)
  const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n);
  const okKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 160 && !/[\u0000-\u001f<>]/.test(k);
  const okDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  function sanitize(obj) {
    const out = {};
    const items = obj && typeof obj === "object" && obj.items && typeof obj.items === "object" ? obj.items : {};
    let n = 0;
    for (const [k, v] of Object.entries(items)) {
      if (n >= MAX_ITEMS) break;
      if (!okKey(k) || !v || typeof v !== "object") continue;
      out[k] = { d: okDate(v.d) ? v.d : today(), n: clean(v.n, 80), m: clean(v.m, MAX_MEMO) };
      n++;
    }
    return out;
  }
  const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  let items = {};
  try { items = sanitize(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { items = {}; }
  let storageOk = true;
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, items })); storageOk = true; }
    catch (e) { storageOk = false; }
  };

  const start = () => {
    const { map, rows, F, SECTS, TIERS, openPopup, flyTo, esc, fmt, val, setVisited, setVisitMode } = window.TM;
    const keyOf = (r) => (F.id !== undefined && r[F.id]) || r[F.wd] || r[F.osm] || `${r[F.name]}@${(+r[F.lat]).toFixed(4)},${(+r[F.lon]).toFixed(4)}`;
    const idxOf = new Map();
    rows.forEach((r, i) => { const k = keyOf(r); if (!idxOf.has(k)) idxOf.set(k, i); });
    const visitedIdx = () => new Set(Object.keys(items).map((k) => idxOf.get(k)).filter((i) => i !== undefined));
    const counted = (r) => r[F.kind] !== 2;   // 名前のないものは数えない

    // ---------- タブと画面
    const tab = document.createElement("button");
    tab.className = "tab"; tab.dataset.tab = "visit"; tab.textContent = "参拝記録";
    document.querySelector('.tab[data-tab="history"]').before(tab);
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === tab));
      document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "pane-visit"));
      render();
    };
    const pane = document.createElement("section");
    pane.className = "pane"; pane.id = "pane-visit";
    document.getElementById("pane-history").before(pane);

    const css = document.createElement("style");
    css.textContent = `
      .tabs{overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tabs .tab{flex:1 0 auto;font-size:12px;padding-left:5px;padding-right:5px}
      .vs-hero{background:#fffdf8;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:4px 0 12px}
      .vs-hero .big{font-family:var(--font);font-size:28px;color:var(--accent)}.vs-hero .big small{font-size:14px;color:var(--ink-2)}
      .vs-bar{height:8px;background:var(--paper-2);border-radius:4px;overflow:hidden;margin:6px 0 2px}.vs-bar i{display:block;height:100%;background:#c9a227}
      .vs-seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:6px 0 12px}
      .vs-seg button{flex:1;border:0;background:#fffdf8;padding:7px 0;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ink)}
      .vs-seg button.on{background:var(--accent);color:#fff}
      .vs-rows{list-style:none;margin:0 0 12px;padding:0}.vs-rows li{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:5px 0;font-size:12.5px;border-bottom:1px dashed var(--line)}
      .vs-rows .vs-bar{grid-column:1/3;margin:0;height:5px}.vs-rows .done{color:#8a6d0b;font-weight:600}
      .vs-log{list-style:none;margin:0 0 12px;padding:0}.vs-log li{padding:7px 4px;border-bottom:1px dashed var(--line);cursor:pointer;font-size:13px}
      .vs-log li:hover{background:var(--paper-2)}.vs-log .d{color:var(--ink-2);font-size:11.5px;margin-right:6px}.vs-log .m{display:block;color:var(--ink-2);font-size:11.5px}
      .vs-tools{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.vs-tools button,.vs-tools label{border:1px solid var(--line);background:#fffdf8;border-radius:6px;padding:6px 10px;font:inherit;font-size:12.5px;cursor:pointer;color:var(--ink)}
      .vs-tools .danger{color:#8e2a21}
      .visit-box{margin:10px 0 6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fffdf8}
      .visit-btn{width:100%;border:0;border-radius:6px;background:var(--accent);color:#fff;padding:8px;font:inherit;font-size:14px;cursor:pointer}
      .visit-box.done{border-color:#c9a227;background:#fbf5e0}.visit-box .ok{font-weight:600;color:#8a6d0b}
      .visit-box .row{display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12px}
      .visit-box input[type=date],.visit-box input[type=text]{flex:1;min-width:0;padding:5px 6px;border:1px solid var(--line);border-radius:5px;font:inherit;font-size:12.5px;background:#fff}
      .visit-box .undo{border:0;background:none;color:var(--ink-2);text-decoration:underline;font:inherit;font-size:12px;cursor:pointer;padding:0}`;
    document.head.appendChild(css);

    let mode = "all";
    const apply = () => { setVisited(visitedIdx()); };

    // ---------- 寺の詳細ポップアップに「行った」欄を付ける
    const fillSlot = (i, el) => {
      const slot = el.querySelector(".visit-slot");
      if (!slot) return;
      const r = rows[i], k = keyOf(r), v = items[k];
      if (!v) {
        slot.innerHTML = `<div class="visit-box"><button class="visit-btn" type="button">⛩ ここに行った!(参拝記録に追加)</button></div>`;
        slot.querySelector(".visit-btn").onclick = () => {
          items[k] = { d: today(), n: clean(r[F.name], 80), m: "" };
          save(); apply(); fillSlot(i, el); render();
        };
        return;
      }
      slot.innerHTML = `<div class="visit-box done"><span class="ok">✓ 参拝済み</span>
        <div class="row">参拝日 <input type="date" value="${esc(v.d)}" max="${today()}"></div>
        <div class="row">メモ <input type="text" maxlength="${MAX_MEMO}" placeholder="御朱印をいただいた など" value="${esc(v.m)}"></div>
        <div class="row"><button class="undo" type="button">記録を取り消す</button>${storageOk ? "" : ' <span style="color:#8e2a21">※保存できませんでした(ブラウザの設定を確認してください)</span>'}</div></div>`;
      const [dIn, mIn] = slot.querySelectorAll("input");
      dIn.onchange = () => { if (okDate(dIn.value)) { v.d = dIn.value; save(); render(); } };
      mIn.onchange = () => { v.m = clean(mIn.value, MAX_MEMO); save(); render(); };
      slot.querySelector(".undo").onclick = () => { delete items[k]; save(); apply(); fillSlot(i, el); render(); };
    };
    document.addEventListener("temple-popup", (e) => fillSlot(e.detail.i, e.detail.el));

    // ---------- 市区町村(muni.json があれば)
    let muni = null;
    fetch("data/muni.json").then((r) => (r.ok ? r.json() : null)).then((gj) => {
      if (!gj?.features) return;
      muni = gj.features.map((f) => {
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
        let b = [180, 90, -180, -90];
        polys.forEach((p) => p[0].forEach(([x, y]) => { b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; }));
        return { n: f.properties.n, t: f.properties.t || 0, polys, b };
      });
      render();
    }).catch(() => {});
    const inRing = (x, y, ring) => {
      let c = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a], [xb, yb] = ring[b];
        if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
      }
      return c;
    };
    const muniOf = (r) => {
      const x = +r[F.lon], y = +r[F.lat];
      return muni.find((m) => x >= m.b[0] && x <= m.b[2] && y >= m.b[1] && y <= m.b[3] &&
        m.polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))));
    };

    // ---------- 制覇状況の表示
    const bar = (a, b) => `<div class="vs-bar"><i style="width:${b ? Math.min(100, (a / b) * 100).toFixed(1) : 0}%"></i></div>`;
    const line = (label, a, b) => `<li><span>${label}</span><span class="${b && a >= b ? "done" : ""}">${fmt(a)} / ${fmt(b)}${b && a >= b ? " 制覇!" : ""}</span>${bar(a, b)}</li>`;
    function render() {
      if (!pane.classList.contains("active")) return;
      const vset = visitedIdx();
      const all = rows.filter(counted);
      const vis = all.filter((r) => vset.has(r.__i));
      const outside = Object.keys(items).length - vset.size;
      const cnt = (pred) => [vis.filter(pred).length, all.filter(pred).length];
      const tierRows = TIERS.filter((t) => t.tier <= 3).map((t) => { const [a, b] = cnt((r) => r[F.tier] === t.tier); return b ? line(esc(t.name), a, b) : ""; }).join("");
      const flagRows = [["札所", "霊場の札所"], ["国宝", "国宝のある寺"], ["重文", "重要文化財のある寺"]]
        .map(([f, l]) => { const [a, b] = cnt((r) => (val(r, "flags") || "").includes("|" + f + "|")); return b ? line(l, a, b) : ""; }).join("");
      const sectRows = SECTS.map((s, si) => [s, ...cnt((r) => r[F.sect] === si)]).filter(([, , b]) => b > 0)
        .sort((x, y) => y[1] - x[1] || y[2] - x[2])
        .map(([s, a, b]) => line(`<span class="dot" style="background:${s.color};display:inline-block;margin-right:5px"></span>${esc(s.name)}`, a, b)).join("");
      let muniHtml = "";
      if (muni) {
        const by = new Map();
        vis.filter((r) => r[F.kind] === 0).forEach((r) => { const m = muniOf(r); if (m) by.set(m, (by.get(m) || 0) + 1); });
        const withT = muni.filter((m) => m.t > 0);
        const done = withT.filter((m) => (by.get(m) || 0) >= m.t).length;
        const list = [...by.entries()].sort((x, y) => y[1] / (y[0].t || 1) - x[1] / (x[0].t || 1)).slice(0, 30);
        muniHtml = `<h2>市区町村</h2><p class="muted small">お寺のある ${fmt(withT.length)} 市区町村のうち、全部まわったのは ${fmt(done)}。参拝した寺がある ${fmt(by.size)} 市区町村:</p>
          <ul class="vs-rows">${list.map(([m, a]) => line(esc(m.n), Math.min(a, m.t || a), m.t || a)).join("") || '<li class="muted">まだありません</li>'}</ul>`;
      }
      const log = Object.entries(items).map(([k, v]) => ({ k, v, i: idxOf.get(k) })).sort((x, y) => (y.v.d > x.v.d ? 1 : y.v.d < x.v.d ? -1 : 0)).slice(0, 100);
      pane.innerHTML = `
        <div class="vs-hero"><div class="muted small">参拝した寺</div>
          <div class="big">${fmt(vis.length)} <small>/ ${fmt(all.length)} 寺(${all.length ? ((vis.length / all.length) * 100).toFixed(1) : 0}%)</small></div>
          ${bar(vis.length, all.length)}
          ${outside > 0 ? `<div class="muted small">ほかに、いま表示中の地域外の記録が ${fmt(outside)} 件あります。</div>` : ""}</div>
        <div class="muted small">地図に表示する寺</div>
        <div class="vs-seg">${[["all", "すべて"], ["yes", "行った寺"], ["no", "まだの寺"]].map(([m, l]) => `<button data-m="${m}" class="${mode === m ? "on" : ""}">${l}</button>`).join("")}</div>
        <p class="muted small">地図の寺を押して「ここに行った!」で記録できます。参拝済みの寺は<span style="color:#8a6d0b">金色の輪</span>で囲まれます。</p>
        ${tierRows ? `<h2>寺格</h2><ul class="vs-rows">${tierRows}</ul>` : ""}
        ${flagRows ? `<h2>札所・文化財</h2><ul class="vs-rows">${flagRows}</ul>` : ""}
        <h2>宗派</h2><ul class="vs-rows">${sectRows}</ul>
        ${muniHtml}
        <h2>参拝の記録</h2>
        <ul class="vs-log">${log.map(({ v, i }) => `<li ${i !== undefined ? `data-idx="${i}"` : ""}><span class="d">${esc(v.d)}</span>${esc(v.n || "(名前不明)")}${i === undefined ? ' <span class="muted small">(地域外)</span>' : ""}${v.m ? `<span class="m">${esc(v.m)}</span>` : ""}</li>`).join("") || '<li class="muted">まだ記録がありません</li>'}</ul>
        <div class="vs-tools">
          <button data-act="export">記録を書き出す(バックアップ)</button>
          <label>記録を読み込む<input type="file" accept="application/json,.json" hidden></label>
          <button data-act="clear" class="danger">記録をすべて消す</button>
        </div>
        <p class="muted small">記録はこの端末のブラウザの中だけに保存され、サーバーには送信されません。別の端末やブラウザでは見えないため、機種変更の前などに「書き出す」でバックアップしてください。${storageOk ? "" : '<br><b style="color:#8e2a21">いまは保存できない状態です(プライベートブラウズ等)。ページを閉じると記録が消えます。</b>'}</p>`;
    }
    pane.addEventListener("click", (e) => {
      const seg = e.target.closest(".vs-seg button");
      if (seg) { mode = seg.dataset.m; setVisitMode(mode); render(); return; }
      const li = e.target.closest(".vs-log li[data-idx]");
      if (li) { flyTo(+li.dataset.idx); return; }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "export") {
        const blob = new Blob([JSON.stringify({ v: 1, app: "temple-map", exported: today(), items }, null, 1)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `参拝記録_${today()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      if (act === "clear" && Object.keys(items).length && confirm(`参拝記録 ${Object.keys(items).length} 件をすべて消します。元に戻せません。よろしいですか?`)) {
        items = {}; save(); apply(); render();
      }
    });
    pane.addEventListener("change", (e) => {
      const inp = e.target.closest('input[type="file"]');
      if (!inp || !inp.files[0]) return;
      const f = inp.files[0];
      if (f.size > MAX_FILE) { alert("ファイルが大きすぎます。"); return; }
      f.text().then((t) => {
        const add = sanitize(JSON.parse(t));
        const n = Object.keys(add).length;
        if (!n) { alert("参拝記録が見つかりませんでした。"); return; }
        // 既存の記録とまとめる(同じ寺は日付の早いほうを残す)
        for (const [k, v] of Object.entries(add)) if (!items[k] || v.d < items[k].d) items[k] = { ...v, m: v.m || items[k]?.m || "" };
        save(); apply(); render();
        alert(`${n} 件の記録を読み込みました。`);
      }).catch(() => alert("読み込めませんでした。このサイトで書き出したファイルを選んでください。"));
      inp.value = "";
    });

    apply();
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
