// スマホ・狭い画面での絞り込みパネルの操作
(function () {
  "use strict";
  const panel = document.getElementById("panel");
  const isNarrow = () => window.innerWidth <= 760;
  const count = () => {
    const m = (document.getElementById("visibleCount").textContent || "").match(/[\d,]+/);
    return m ? m[0] : "";
  };
  const close = () => { panel.classList.add("closed"); panel.classList.remove("expanded"); };

  // 「地図を見る(○件)」と「☰ 絞り込み・○件」に表示件数を出す
  const update = () => {
    const n = count();
    document.getElementById("showMap").textContent = n ? `地図を見る(${n} 件)` : "地図を見る";
    document.getElementById("panelOpen").textContent = n ? `☰ 絞り込み・${n} 件` : "☰ 絞り込み";
  };
  update();
  new MutationObserver(update).observe(document.getElementById("visibleCount"), { childList: true, characterData: true, subtree: true });

  document.getElementById("showMap").addEventListener("click", close);
  // ハンドルを押すとパネルの高さを 半分 ⇔ ほぼ全画面 で切り替え
  document.getElementById("sheetHandle").addEventListener("click", () => panel.classList.toggle("expanded"));
  // 地図をタップしたらパネルを閉じる
  document.getElementById("map").addEventListener("click", () => { if (isNarrow()) close(); });
  // パネルを開くときは半分の高さで(地図の変化を見ながら絞り込める)
  document.getElementById("panelOpen").addEventListener("click", () => panel.classList.remove("expanded"));
})();
