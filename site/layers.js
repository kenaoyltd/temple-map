// 地図上の検索窓(人物でゆかりの地を探す)と、表示切り替えスイッチ
(function () {
  "use strict";
  const start = () => {
    const { map, esc } = window.TM;
    const box = map.getContainer();
    const narrow = () => window.innerWidth <= 760;

    const css = document.createElement("style");
    css.textContent = `
      .map-search{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:5;display:flex;width:min(440px,calc(100% - 140px));
        background:var(--paper);border:1px solid var(--line);border-radius:24px;box-shadow:0 2px 10px rgba(0,0,0,.18);overflow:hidden}
      .map-search input{flex:1;min-width:0;border:0;background:transparent;padding:10px 14px;font:inherit;font-size:14px;color:var(--ink)}
      .map-search input:focus{outline:none}
      .map-search button{border:0;background:var(--accent);color:#fff;padding:0 16px;font:inherit;font-size:14px;cursor:pointer}
      .layer-box{position:absolute;left:12px;bottom:28px;z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:10px;
        box-shadow:0 2px 10px rgba(0,0,0,.15);padding:8px 12px;font-size:13px;min-width:170px}
      .layer-box h4{margin:0 0 4px;font-size:12px;color:var(--ink-2);font-weight:600;display:flex;justify-content:space-between;align-items:center;cursor:pointer}
      .layer-box.min .sw-row{display:none}
      .sw-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;cursor:pointer;user-select:none}
      .sw-row.disabled{opacity:.4;cursor:default}
      .sw{position:relative;width:36px;height:20px;border-radius:10px;background:#cfc6b6;flex:none;transition:background .15s}
      .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .15s}
      .sw-row.on .sw{background:var(--accent)}.sw-row.on .sw::after{left:18px}
      @media (max-width:760px){
        .map-search{left:12px;right:56px;transform:none;width:auto}
        .panel-open{top:64px !important}
        .layer-box{bottom:auto;top:110px;left:12px;padding:6px 10px;min-width:150px}
      }`;
    document.head.appendChild(css);

    // ---------- 検索窓
    const form = document.createElement("form");
    form.className = "map-search";
    form.innerHTML = `<input type="search" list="psList" placeholder="人物名でゆかりの地を検索(例:徳川家康)" aria-label="人物名でゆかりの地を検索"><button>検索</button>`;
    box.appendChild(form);
    ["click", "mousedown", "touchstart", "dblclick", "wheel"].forEach((ev) => form.addEventListener(ev, (e) => e.stopPropagation()));
    const q = form.querySelector("input");
    q.addEventListener("input", () => {  // 候補(サジェスト)はタブ内の欄と共通
      const ps = document.getElementById("psInput");
      if (ps) { ps.value = q.value; ps.dispatchEvent(new Event("input")); }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = q.value.trim();
      const ps = document.getElementById("psInput");
      if (!v || !ps) return;
      ps.value = v;
      document.querySelector('.tab[data-tab="person"]')?.click();
      const panel = document.getElementById("panel");
      panel.classList.remove("closed");
      panel.classList.remove("expanded");
      document.getElementById("psForm").requestSubmit();
      q.blur();
    });

    // ---------- 表示スイッチ
    const lb = document.createElement("div");
    lb.className = "layer-box" + (narrow() ? " min" : "");
    lb.innerHTML = `<h4><span>表示の切り替え</span><span class="tg">${narrow() ? "▼" : "▲"}</span></h4>
      <div class="sw-row on" data-k="temples"><span>寺院</span><span class="sw"></span></div>
      <div class="sw-row disabled" data-k="person"><span>ゆかりの地(検索結果)</span><span class="sw"></span></div>
      <div class="sw-row disabled" data-k="stats"><span>地域の統計</span><span class="sw"></span></div>`;
    box.appendChild(lb);
    ["click", "mousedown", "touchstart", "dblclick", "wheel"].forEach((ev) => lb.addEventListener(ev, (e) => e.stopPropagation()));
    lb.querySelector("h4").addEventListener("click", () => {
      lb.classList.toggle("min");
      lb.querySelector(".tg").textContent = lb.classList.contains("min") ? "▼" : "▲";
    });
    const row = (k) => lb.querySelector(`.sw-row[data-k="${k}"]`);
    const isOn = (k) => row(k).classList.contains("on");
    const setRow = (k, on) => row(k).classList.toggle("on", !!on);
    const vis = (layers, on) => layers.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));

    const setTemples = (on) => { setRow("temples", on); vis(["temples", "labels", "labels-all"], on); };
    const setPerson = (on) => { setRow("person", on); vis(["person-pt", "person-label"], on); };
    const setStats = (on) => {
      const sel = document.getElementById("statSel");
      if (!sel) return;
      if (on && !sel.value) sel.value = sel.dataset.last || "rate";
      if (!on && sel.value) { sel.dataset.last = sel.value; sel.value = ""; }
      sel.dispatchEvent(new Event("change"));
      setRow("stats", on);
    };

    lb.addEventListener("click", (e) => {
      const r = e.target.closest(".sw-row");
      if (!r || r.classList.contains("disabled")) return;
      const k = r.dataset.k, on = !isOn(k);
      if (k === "temples") { setTemples(on); templesAuto = false; }
      if (k === "person") setPerson(on);
      if (k === "stats") setStats(on);
    });

    // 人物検索の結果が出たら、寺院の点を自動で隠して見やすくする(消したら元に戻す)
    let templesAuto = false;
    document.addEventListener("person-results", (e) => {
      const n = e.detail?.n || 0;
      row("person").classList.toggle("disabled", n === 0);
      if (n > 0) {
        setPerson(true);
        if (isOn("temples")) { setTemples(false); templesAuto = true; }
      } else {
        setRow("person", false);
        if (templesAuto) { setTemples(true); templesAuto = false; }
      }
    });

    // 統計:データがあるときだけ使える。プルダウンを直接変えたときもスイッチを合わせる
    const hookStats = () => {
      const sel = document.getElementById("statSel");
      if (!sel) return false;
      row("stats").classList.remove("disabled");
      sel.addEventListener("change", () => setRow("stats", !!sel.value));
      return true;
    };
    if (!hookStats()) {
      const mo = new MutationObserver(() => { if (hookStats()) mo.disconnect(); });
      mo.observe(document.getElementById("pane-filter"), { childList: true, subtree: true });
    }
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
