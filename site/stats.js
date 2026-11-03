// 市区町村ごとの統計(高齢化率など)を地図に色分け表示する
(function () {
  "use strict";
  const METRICS = [
    { k: "rate", label: "高齢化率(65歳以上の割合)", unit: "%", fmt: (v) => v.toFixed(1) + "%",
      val: (p) => (p.pop ? (p.old / p.pop) * 100 : null) },
    { k: "oldPer", label: "お寺1か寺あたりの65歳以上人口", unit: "人", fmt: (v) => Math.round(v).toLocaleString("ja-JP") + "人",
      val: (p) => (p.pop && p.t ? p.old / p.t : null) },
    { k: "deathPer", label: "お寺1か寺あたりの年間死亡者数", unit: "人", fmt: (v) => v.toFixed(1) + "人",
      val: (p) => (p.pop && p.t ? p.d / p.t : null) },
    { k: "pop", label: "人口", unit: "人", fmt: (v) => Math.round(v).toLocaleString("ja-JP") + "人",
      val: (p) => (p.pop ? p.pop : null) },
  ];
  // 一色の濃淡(薄い→濃い)
  const RAMP = ["#f6e7cf", "#ecc79b", "#dc9c6b", "#c26a45", "#93392a"];

  const start = () => {
    const { map, esc } = window.TM;
    fetch("data/muni.json").then((r) => (r.ok ? r.json() : Promise.reject())).then((gj) => {
      // 選択欄を「寺格」ブロックの前に追加
      const block = document.createElement("div");
      block.className = "block";
      block.innerHTML = `<div class="block-head"><h2>地域の統計(色分け)</h2></div>
        <select id="statSel" class="stat-sel"><option value="">表示しない</option>${METRICS.map((m) => `<option value="${m.k}">${esc(m.label)}</option>`).join("")}</select>
        <div id="statLegend" class="stat-legend"></div>
        <p class="muted small stat-note">市区町村ごと。人口・死亡者数は${esc(gj.meta?.pop_source || "総務省 住民基本台帳")}、お寺の数はこの地図の登録件数(実際より少ないことがあります)。</p>`;
      document.querySelector("#pyramid").closest(".block").before(block);

      map.addSource("muni", { type: "geojson", data: gj });
      map.addLayer({ id: "muni-fill", type: "fill", source: "muni", layout: { visibility: "none" },
        paint: { "fill-color": "#000", "fill-opacity": 0.55 } }, "temples");
      map.addLayer({ id: "muni-line", type: "line", source: "muni", layout: { visibility: "none" },
        paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.8 } }, "temples");

      // 各指標の値を前計算して properties に入れる
      gj.features.forEach((f) => METRICS.forEach((m) => { const v = m.val(f.properties); f.properties["m_" + m.k] = v == null ? -1 : v; }));
      map.getSource("muni").setData(gj);

      const css = document.createElement("style");
      css.textContent = `.stat-sel{width:100%;padding:7px 8px;border:1px solid var(--line);border-radius:6px;background:#fffdf8;font:inherit;font-size:13px}
        .stat-legend{display:flex;margin-top:8px;font-size:11px;color:var(--ink-2)}.stat-legend div{flex:1;text-align:center}.stat-legend span{display:block;height:10px;border-radius:2px;margin:0 1px 3px}
        .stat-note{margin:6px 0 0}.muni-pop h3{font-family:var(--font);font-size:16px;margin:0 0 6px}.muni-pop dl{display:grid;grid-template-columns:auto auto;gap:2px 10px;margin:0;font-size:12.5px}.muni-pop dt{color:var(--ink-2)}.muni-pop dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}`;
      document.head.appendChild(css);

      let current = null;
      const apply = (k) => {
        current = METRICS.find((m) => m.k === k) || null;
        const vis = current ? "visible" : "none";
        map.setLayoutProperty("muni-fill", "visibility", vis);
        map.setLayoutProperty("muni-line", "visibility", vis);
        const lg = document.getElementById("statLegend");
        if (!current) { lg.innerHTML = ""; return; }
        // 5段階(件数が均等になる区切り)
        const vals = gj.features.map((f) => f.properties["m_" + k]).filter((v) => v >= 0).sort((a, b) => a - b);
        const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
        const br = [q(0.2), q(0.4), q(0.6), q(0.8)];
        map.setPaintProperty("muni-fill", "fill-color", ["case", ["<", ["get", "m_" + k], 0], "#d9d4cc",
          ["step", ["get", "m_" + k], RAMP[0], br[0], RAMP[1], br[1], RAMP[2], br[2], RAMP[3], br[3], RAMP[4]]]);
        const edges = [vals[0], ...br, vals[vals.length - 1]];
        lg.innerHTML = RAMP.map((c, i) => `<div><span style="background:${c}"></span>${esc(current.fmt(edges[i]))}〜</div>`).join("");
      };
      document.getElementById("statSel").addEventListener("change", (e) => apply(e.target.value));

      // 区域をクリックすると数値を表示(寺の点をクリックしたときは寺の詳細を優先)
      map.on("click", "muni-fill", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["temples"] }).length) return;
        const p = e.features[0].properties;
        const row = (label, v) => `<dt>${label}</dt><dd>${v}</dd>`;
        const per = (a) => (p.t ? a / p.t : null);
        const html = `<div class="muni-pop"><h3>${esc(p.n)}</h3><dl>
          ${p.pop ? row("人口", (+p.pop).toLocaleString("ja-JP") + "人") : ""}
          ${p.pop ? row("高齢化率", ((p.old / p.pop) * 100).toFixed(1) + "%") : ""}
          ${p.pop ? row("年間死亡者数", (+p.d).toLocaleString("ja-JP") + "人") : ""}
          ${row("地図上のお寺", (+p.t).toLocaleString("ja-JP") + "か寺")}
          ${p.pop && p.t ? row("1か寺あたり65歳以上", Math.round(per(p.old)).toLocaleString("ja-JP") + "人") : ""}
          ${p.pop && p.t ? row("1か寺あたり年間死亡者", per(p.d).toFixed(1) + "人") : ""}
        </dl></div>`;
        new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on("mouseenter", "muni-fill", () => { if (current) map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "muni-fill", () => { map.getCanvas().style.cursor = ""; });
    }).catch(() => { /* 統計データがない場合は何も表示しない */ });
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
