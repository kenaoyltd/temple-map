// 音声検索:地図上の検索窓にマイクボタンを付ける。
// 話した言葉はブラウザの音声認識機能で文字にして、検索窓と同じ振り分け(寺・人物・近くの寺)で検索する。
// このサイト自身は音声を録音・保存・送信しない。
(function () {
  "use strict";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const start = () => {
    const form = document.querySelector(".map-search");
    if (!form || !SR) return;   // 音声認識に対応していないブラウザではボタンを出さない
    const input = form.querySelector("input");

    const css = document.createElement("style");
    css.textContent = `
      .map-search .mic{border:0;background:transparent;color:var(--ink-2);padding:0 10px;cursor:pointer;display:grid;place-items:center}
      .map-search .mic svg{width:20px;height:20px}
      .map-search .mic.on{color:#fff;background:#d33;animation:micpulse 1.2s infinite}
      @keyframes micpulse{0%,100%{box-shadow:inset 0 0 0 0 rgba(255,255,255,.5)}50%{box-shadow:inset 0 0 0 6px rgba(255,255,255,.15)}}
      .voice-toast{position:absolute;top:62px;left:50%;transform:translateX(-50%);z-index:6;background:rgba(43,38,32,.9);color:#fff;
        padding:8px 14px;border-radius:18px;font-size:13px;max-width:calc(100% - 40px);pointer-events:none;transition:opacity .2s}
      .voice-toast.hide{opacity:0}
      @media (max-width:760px){.voice-toast{top:60px}}`;
    document.head.appendChild(css);

    const mic = document.createElement("button");
    mic.type = "button";
    mic.className = "mic";
    mic.setAttribute("aria-label", "声で検索");
    mic.title = "声で検索(例:「善光寺」「徳川家康のゆかりの地」「近くのお寺」)";
    mic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
    form.insertBefore(mic, form.querySelector("button:not(.mic)"));

    const toast = document.createElement("div");
    toast.className = "voice-toast hide";
    toast.setAttribute("role", "status");
    form.parentNode.appendChild(toast);
    let tTimer = null;
    const say = (msg, ms = 2500) => {
      toast.textContent = msg; toast.classList.remove("hide");
      clearTimeout(tTimer); if (ms) tTimer = setTimeout(() => toast.classList.add("hide"), ms);
    };

    let rec = null, listening = false, finalText = "";
    const stop = () => { try { rec && rec.stop(); } catch (e) { /* 何もしない */ } };
    mic.addEventListener("click", () => {
      if (listening) { stop(); return; }
      rec = new SR();
      rec.lang = "ja-JP";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      finalText = "";
      rec.onstart = () => { listening = true; mic.classList.add("on"); say("お話しください…(例:「善光寺」「豊臣秀吉のゆかりの地」「近くのお寺」)", 0); };
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        input.value = (finalText + interim).slice(0, 60);
        say("「" + input.value + "」", 0);
      };
      rec.onerror = (e) => {
        const m = { "not-allowed": "マイクの使用が許可されていません。ブラウザの設定でこのサイトのマイクを許可してください。",
          "service-not-allowed": "この端末では音声認識が使えません。", "no-speech": "声が聞き取れませんでした。もう一度お試しください。",
          "audio-capture": "マイクが見つかりません。", network: "音声認識の通信ができませんでした。" }[e.error];
        if (m) say(m, 4000);
      };
      rec.onend = () => {
        listening = false; mic.classList.remove("on");
        const t = finalText.trim();
        if (!t) { if (!toast.textContent.includes("聞き取れ") && !toast.textContent.includes("許可")) toast.classList.add("hide"); return; }
        input.value = t.slice(0, 60);
        const kind = window.TMSearch ? window.TMSearch(t) : null;
        const shown = window.TMSearch?.last || t;
        say({ temple: `「${shown}」を表示します`, temples: `「${shown}」の候補を表示します`, person: `「${shown}」のゆかりの地を探します`, near: "現在地の近くを表示します" }[kind] || `「${shown}」で検索します`);
      };
      try { rec.start(); } catch (e) { say("音声認識を開始できませんでした。", 3000); }
    });
  };
  if (window.TM) start(); else document.addEventListener("tm-ready", start, { once: true });
})();
