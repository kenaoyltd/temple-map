// 人物カード:人物の名前をクリックすると、生没年・説明・家系図(父母・配偶者・兄弟姉妹・子)を表示する
(function () {
  "use strict";
  const WD = "https://www.wikidata.org/w/api.php";
  const WPR = "https://ja.wikipedia.org/api/rest_v1/page/summary/";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wd = (q) => fetch(`${WD}?${new URLSearchParams({ ...q, format: "json", origin: "*" })}`).then((r) => r.json());
  const year = (c) => {
    const t = c?.[0]?.mainsnak?.datavalue?.value?.time;
    const m = t && t.match(/^([+-])0*(\d+)-/);
    return m ? (m[1] === "-" ? "紀元前" : "") + m[2] : "";
  };
  const ids = (claims, p) => (claims[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

  const css = document.createElement("style");
  css.textContent = `
    .fam-back{position:fixed;inset:0;z-index:50;background:rgba(43,38,32,.45);display:flex;align-items:center;justify-content:center;padding:16px}
    .fam{background:var(--paper);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3);width:min(640px,100%);max-height:88vh;overflow-y:auto;padding:18px 20px 16px;position:relative}
    .fam h3{font-family:var(--font);font-size:22px;margin:0 32px 2px 0}.fam .life{color:var(--ink-2);font-size:13px}
    .fam .summary{font-size:13px;line-height:1.75;margin:10px 0 4px}
    .fam .x{position:absolute;top:10px;right:12px;border:0;background:var(--paper-2);width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer}
    .tree{margin:14px 0 6px;display:flex;flex-direction:column;align-items:center;gap:0}
    .gen{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:100%}
    .gen-label{font-size:11px;color:var(--ink-2);text-align:center;margin:2px 0 4px;letter-spacing:.1em}
    .vline{width:2px;height:16px;background:var(--line);margin:2px 0}
    .pn{border:1px solid var(--line);background:#fffdf8;border-radius:6px;padding:5px 10px;font:inherit;font-size:13px;color:var(--ink);cursor:pointer}
    .pn:hover{border-color:var(--accent);color:var(--accent)}.pn[disabled]{cursor:default;color:var(--ink-2);border-style:dashed}
    .pn.me{background:var(--accent);border-color:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:default;padding:7px 14px}
    .parents{display:flex;gap:28px;justify-content:center;flex-wrap:wrap}
    .row-me{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}.eq{color:var(--ink-2);font-size:13px}
    .side{margin-top:10px;width:100%}.side .gen{justify-content:center}
    .fam .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;border-top:1px dashed var(--line);padding-top:12px}
    .fam .acts button,.fam .acts a{border:1px solid var(--line);background:#fffdf8;border-radius:6px;padding:7px 12px;font:inherit;font-size:13px;color:var(--ink);cursor:pointer;text-decoration:none}
    .fam .acts .primary{background:var(--accent);border-color:var(--accent);color:#fff}
    .fam .note{font-size:11px;color:var(--ink-2);margin-top:8px}
    .pname{color:var(--accent);text-decoration:underline dotted;cursor:pointer}
    @media (max-width:760px){.fam-back{padding:0;align-items:flex-end}.fam{border-radius:14px 14px 0 0;max-height:92vh}}`;
  document.head.appendChild(css);

  let back = null;
  const close = () => { if (back) { back.remove(); back = null; } };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  async function showFamily(title) {
    close();
    back = document.createElement("div");
    back.className = "fam-back";
    back.innerHTML = `<div class="fam"><button class="x" aria-label="閉じる">✕</button><p class="life">「${esc(title)}」を読み込み中…</p></div>`;
    document.body.appendChild(back);
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest(".x")) close(); });
    const box = back.querySelector(".fam");
    try {
      const j = await wd({ action: "wbgetentities", sites: "jawiki", titles: title, redirects: "yes", props: "claims|labels|descriptions|sitelinks", languages: "ja", sitefilter: "jawiki" });
      const e = Object.values(j.entities || {})[0];
      if (!e || e.missing !== undefined) { box.innerHTML = `<button class="x">✕</button><p>「${esc(title)}」の人物情報が見つかりませんでした。</p>`; return; }
      const cl = e.claims || {};
      const rel = { father: ids(cl, "P22"), mother: ids(cl, "P25"), spouse: ids(cl, "P26"), sib: ids(cl, "P3373"), child: ids(cl, "P40") };
      const all = [...new Set(Object.values(rel).flat())];
      const info = {};
      for (let i = 0; i < all.length; i += 50) {
        const k = await wd({ action: "wbgetentities", ids: all.slice(i, i + 50).join("|"), props: "labels|sitelinks", languages: "ja", sitefilter: "jawiki" });
        Object.assign(info, k.entities || {});
      }
      const wpTitle = e.sitelinks?.jawiki?.title || title;
      const summary = await fetch(WPR + encodeURIComponent(wpTitle.replace(/ /g, "_"))).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const btn = (id) => {
        const it = info[id] || {};
        const label = it.labels?.ja?.value || id;
        const t = it.sitelinks?.jawiki?.title;
        return t ? `<button class="pn" data-t="${esc(t)}">${esc(label)}</button>` : `<button class="pn" disabled title="Wikipediaに記事がありません">${esc(label)}</button>`;
      };
      const gen = (label, list) => list.length ? `<div class="gen-label">${label}</div><div class="gen">${list.map(btn).join("")}</div>` : "";
      const name = e.labels?.ja?.value || wpTitle;
      const b = year(cl.P569), d = year(cl.P570);
      const hasTree = all.length > 0;
      box.innerHTML = `<button class="x" aria-label="閉じる">✕</button>
        <h3>${esc(name)}</h3>
        <div class="life">${b || d ? `${esc(b || "?")}年 〜 ${esc(d || "?")}年` : ""}${e.descriptions?.ja?.value ? ` ・ ${esc(e.descriptions.ja.value)}` : ""}</div>
        ${summary.extract ? `<p class="summary">${esc(summary.extract.length > 260 ? summary.extract.slice(0, 260) + "…" : summary.extract)}</p>` : ""}
        ${hasTree ? `<div class="tree">
          ${rel.father.length || rel.mother.length ? `<div class="parents">${rel.father.length ? `<div>${gen("父", rel.father)}</div>` : ""}${rel.mother.length ? `<div>${gen("母", rel.mother)}</div>` : ""}</div><div class="vline"></div>` : ""}
          <div class="row-me"><span class="pn me">${esc(name)}</span>${rel.spouse.length ? `<span class="eq">＝ 配偶者</span>${rel.spouse.map(btn).join("")}` : ""}</div>
          ${rel.child.length ? `<div class="vline"></div>${gen(`子(${rel.child.length}人)`, rel.child)}` : ""}
          ${rel.sib.length ? `<div class="side">${gen("兄弟姉妹", rel.sib)}</div>` : ""}
        </div>` : `<p class="note">家系の情報は登録されていません。</p>`}
        <div class="acts">
          <button class="primary" data-act="search">この人物のゆかりの地を地図で探す</button>
          <a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(wpTitle)}" target="_blank" rel="noopener">Wikipedia</a>
          <a href="https://www.wikidata.org/wiki/${e.id}" target="_blank" rel="noopener">Wikidata</a>
        </div>
        <p class="note">名前を押すと、その人物の家系図に移動します。家系の情報はWikidata(誰でも編集できる公開データ)によるもので、抜けや異説がある場合があります。点線の名前はWikipediaに記事がない人物です。</p>`;
      box.addEventListener("click", (ev) => {
        const pn = ev.target.closest(".pn[data-t]");
        if (pn) { showFamily(pn.dataset.t); return; }
        if (ev.target.closest('[data-act="search"]')) {
          close();
          const q = document.querySelector(".map-search input") || document.getElementById("psInput");
          if (q && q.form) { q.value = wpTitle; q.form.requestSubmit(); }
        }
      });
    } catch (err) {
      box.innerHTML = `<button class="x">✕</button><p>読み込めませんでした。時間をおいてもう一度お試しください。</p>`;
    }
  }
  window.showFamily = showFamily;
  // ページ内のどこでも、class="pname" data-name="人物名" の要素を押すと人物カードを開く
  document.addEventListener("click", (e) => {
    const p = e.target.closest(".pname[data-name]");
    if (p) { e.preventDefault(); showFamily(p.dataset.name); }
  });
})();
