// はじめての人向けの案内・地図の見かた(凡例)・都道府県へのジャンプ
(function () {
  "use strict";
  const PREFS = [
    ["北海道", 43.06, 141.35, 6.2], ["青森県", 40.82, 140.74, 7.8], ["岩手県", 39.70, 141.15, 7.6], ["宮城県", 38.27, 140.87, 8],
    ["秋田県", 39.72, 140.10, 7.6], ["山形県", 38.24, 140.36, 7.8], ["福島県", 37.40, 140.20, 7.6], ["茨城県", 36.34, 140.30, 8],
    ["栃木県", 36.57, 139.88, 8.2], ["群馬県", 36.45, 139.00, 8.2], ["埼玉県", 35.96, 139.40, 8.6], ["千葉県", 35.55, 140.20, 8.2],
    ["東京都", 35.69, 139.55, 9], ["神奈川県", 35.40, 139.35, 9], ["新潟県", 37.50, 138.90, 7.4], ["富山県", 36.65, 137.20, 8.6],
    ["石川県", 36.80, 136.70, 7.8], ["福井県", 35.85, 136.20, 8.4], ["山梨県", 35.60, 138.60, 8.6], ["長野県", 36.10, 138.10, 7.6],
    ["岐阜県", 35.75, 137.00, 7.8], ["静岡県", 35.00, 138.30, 8], ["愛知県", 35.05, 137.15, 8.6], ["三重県", 34.50, 136.40, 8],
    ["滋賀県", 35.20, 136.10, 8.6], ["京都府", 35.10, 135.55, 8.2], ["大阪府", 34.65, 135.50, 9], ["兵庫県", 34.95, 134.85, 7.8],
    ["奈良県", 34.40, 135.85, 8.4], ["和歌山県", 33.95, 135.40, 8.2], ["鳥取県", 35.40, 133.80, 8.4], ["島根県", 35.10, 132.55, 7.8],
    ["岡山県", 34.85, 133.80, 8.4], ["広島県", 34.55, 132.75, 8.2], ["山口県", 34.20, 131.55, 8.2], ["徳島県", 33.90, 134.30, 8.6],
    ["香川県", 34.25, 134.00, 9], ["愛媛県", 33.60, 132.80, 8], ["高知県", 33.40, 133.35, 7.8], ["福岡県", 33.60, 130.65, 8.4],
    ["佐賀県", 33.30, 130.10, 9], ["長崎県", 33.00, 129.80, 7.8], ["熊本県", 32.65, 130.75, 8], ["大分県", 33.20, 131.45, 8.2],
    ["宮崎県", 32.20, 131.30, 8], ["鹿児島県", 31.60, 130.55, 7.4], ["沖縄県", 26.40, 127.85, 8],
  ];
  const KEY = "tm.guide.v1";
  const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch (e) { /* 保存できなくても動く */ } };

  const start = () => {
    const { map, rows, F, SECTS, esc, fmt } = window.TM;
    const box = map.getContainer();
    const count = SECTS.map(() => 0);
    rows.forEach((r) => { if (r[F.kind] !== 2) count[r[F.sect]]++; });
    const topSects = SECTS.map((s, i) => [s, count[i]]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

    const css = document.createElement("style");
    css.textContent = `
      .guide-back{position:fixed;inset:0;z-index:60;background:rgba(43,38,32,.5);display:flex;align-items:center;justify-content:center;padding:16px}
      .guide{background:var(--paper);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);width:min(520px,100%);max-height:92vh;overflow-y:auto;padding:20px 22px 18px}
      .guide h2{font-size:21px;margin:0 0 4px}.guide .lead{font-size:13px;color:var(--ink-2);margin:0 0 14px}
      .g-step{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px dashed var(--line)}
      .g-ico{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#fffdf8;border:1px solid var(--line);font-size:18px}
      .g-step b{display:block;font-size:14px;margin-bottom:2px}.g-step p{margin:0;font-size:12.5px;color:var(--ink-2);line-height:1.6}
      .g-dots{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px;font-size:11.5px;color:var(--ink)}
      .g-dots span{display:inline-flex;align-items:center;gap:4px}.g-dots i{width:10px;height:10px;border-radius:50%;display:inline-block}
      .g-size{display:flex;align-items:center;gap:10px;margin-top:4px;font-size:11.5px}.g-size i{display:inline-block;border-radius:50%;background:#b5352a;border:1.5px solid #2b2620}
      .g-go{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px}
      .g-go button,.g-go select{border:1px solid var(--line);background:#fffdf8;border-radius:16px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}
      .g-main{width:100%;margin-top:14px;border:0;border-radius:8px;background:var(--accent);color:#fff;padding:11px;font:inherit;font-size:15px;cursor:pointer}
      .help-btn{position:absolute;top:118px;right:10px;z-index:4;width:29px;height:29px;border-radius:4px;border:0;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.1);
        font:600 15px/1 var(--font-ui);color:var(--ink);cursor:pointer}
      .pref-jump{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:#fffdf8;font:inherit;font-size:13.5px;margin-bottom:10px}
      .legend{border-top:1px dashed var(--line);margin-top:4px;padding-top:4px}.layer-box.min .legend{display:none}
      .legend summary{font-size:12px;color:var(--ink-2);cursor:pointer;padding:3px 0}
      .legend[open]{max-width:230px}.legend .g-dots{display:grid;grid-template-columns:1fr;gap:3px;max-height:170px;overflow-y:auto;margin:4px 0;flex-wrap:nowrap}
      .legend .note{font-size:11px;color:var(--ink-2);line-height:1.5;margin:4px 0 2px}
      @media (max-width:760px){.guide-back{padding:0;align-items:flex-end}.guide{border-radius:16px 16px 0 0;max-height:90vh}.help-btn{top:108px}}`;
    document.head.appendChild(css);

    const dots = (list) => `<div class="g-dots">${list.map(([s, n]) => `<span><i style="background:${s.color}"></i>${esc(s.name)}${n != null ? ` <small class="muted">${fmt(n)}</small>` : ""}</span>`).join("")}</div>`;
    const prefOptions = `<option value="">都道府県へ移動…</option><option value="all">日本全体</option>${PREFS.map(([n], i) => `<option value="${i}">${n}</option>`).join("")}`;
    const jump = (v) => {
      if (v === "all") map.flyTo({ center: [137.5, 37.2], zoom: 4.6 });
      else if (PREFS[v]) map.flyTo({ center: [PREFS[v][2], PREFS[v][1]], zoom: PREFS[v][3], speed: 1.4 });
      if (window.innerWidth <= 760) document.getElementById("panel").classList.add("closed");
    };

    // ---------- はじめての案内
    function openGuide() {
      const back = document.createElement("div");
      back.className = "guide-back";
      back.innerHTML = `<div class="guide" role="dialog" aria-label="地図の見かた">
        <h2>日本の寺院マップへようこそ</h2>
        <p class="lead">${fmt(rows.filter((r) => r[F.kind] !== 2).length)} か寺を、宗派・格式・歴史とともに地図で見られます。</p>
        <div class="g-step"><div class="g-ico">🎨</div><div><b>丸の色 = 宗派</b><p>同じ色が多い地域は、その宗派が広まった土地です。</p>${dots(topSects.slice(0, 8).map(([s]) => [s]))}</div></div>
        <div class="g-step"><div class="g-ico">⛰️</div><div><b>丸の大きさ = 寺の格式</b><p>大きく黒い縁があるほど格が高い寺(総本山・大本山)です。拡大すると小さなお寺も見えてきます。</p>
          <div class="g-size"><i style="width:16px;height:16px"></i>総本山 <i style="width:12px;height:12px"></i>本山 <i style="width:8px;height:8px;border-color:#fff"></i>一般の寺</div></div></div>
        <div class="g-step"><div class="g-ico">👆</div><div><b>寺を押すと、歴史・由来</b><p>創建・開山・本尊・伝説などが読めます。「ここに行った!」を押すと<span style="color:#8a6d0b">金色の輪</span>が付き、参拝の記録になります。</p></div></div>
        <div class="g-step"><div class="g-ico">🎤</div><div><b>話しかけて探せます</b><p>上の検索窓に寺の名前や人物名を入れるか、マイクを押して「善光寺」「徳川家康のゆかりの地」「近くのお寺」と話してください。</p></div></div>
        <div class="g-go">
          <select class="g-pref">${prefOptions}</select>
          <button data-go="near">📍 現在地の近く</button>
          <button data-go="kyoto">京都</button><button data-go="nara">奈良</button><button data-go="koya">高野山</button>
        </div>
        <button class="g-main">地図を見る</button></div>`;
      document.body.appendChild(back);
      const close = () => { back.remove(); markSeen(); };
      back.addEventListener("click", (e) => {
        if (e.target === back || e.target.closest(".g-main")) { close(); return; }
        const go = e.target.closest("[data-go]")?.dataset.go;
        if (!go) return;
        close();
        if (go === "near") document.querySelector(".maplibregl-ctrl-geolocate")?.click();
        if (go === "kyoto") map.flyTo({ center: [135.77, 35.0], zoom: 12.5 });
        if (go === "nara") map.flyTo({ center: [135.83, 34.68], zoom: 13 });
        if (go === "koya") map.flyTo({ center: [135.585, 34.213], zoom: 14 });
      });
      back.querySelector(".g-pref").addEventListener("change", (e) => { if (e.target.value) { close(); jump(e.target.value); } });
      const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
      document.addEventListener("keydown", onKey);
    }
    const help = document.createElement("button");
    help.className = "help-btn"; help.textContent = "?"; help.title = "地図の見かた"; help.setAttribute("aria-label", "地図の見かた");
    help.onclick = openGuide;
    box.appendChild(help);
    if (!seen()) openGuide();

    // ---------- 絞り込みタブの一番上に「都道府県へ移動」
    const sel = document.createElement("select");
    sel.className = "pref-jump"; sel.setAttribute("aria-label", "都道府県へ移動"); sel.innerHTML = prefOptions;
    sel.addEventListener("change", () => { if (sel.value) jump(sel.value); sel.value = ""; });
    document.getElementById("pane-filter").prepend(sel);

    // ---------- 表示切り替えの箱に「色の見かた」
    const addLegend = () => {
      const lb = document.querySelector(".layer-box");
      if (!lb || lb.querySelector(".legend")) return !!lb;
      const d = document.createElement("details");
      d.className = "legend";
      d.innerHTML = `<summary>色と大きさの見かた</summary>${dots(topSects)}
        <p class="note">大きく黒い縁=総本山・大本山/金色の縁=札所・文化財など/<span style="color:#8a6d0b">金色の輪</span>=参拝済み</p>`;
      lb.appendChild(d);
      return true;
    };
    if (!addLegend()) setTimeout(addLegend, 500);
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
