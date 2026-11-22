/**
 * お寺マップ MCP サーバー(Cloudflare Workers 版)
 *
 * AIエージェントからの問い合わせに答えるプログラム。データは GitHub Pages で公開中の
 *   data/temples.json・data/sects.json・data/experiences.json
 * を読み込むだけなので、データベースは不要。
 *
 * 接続先: https://<worker名>.<アカウント>.workers.dev/mcp (MCP Streamable HTTP)
 *
 * 道具:
 *   search_temples    名前・都道府県・市区町村・宗派・体験の種類・現在地からの距離で寺を探す
 *   get_temple        1つの寺の詳しい情報(体験・行事の次の開催日、出典つき)
 *   find_experiences  坐禅会・写経・宿坊・精進料理・縁日・行事の一覧
 *   upcoming_events   期間内の縁日・坐禅会・行事を日付順に
 */

const SERVER = { name: "temple-map", title: "日本の寺院マップ", version: "1.0.0" };
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CACHE_MS = 30 * 60 * 1000; // データを読み直す間隔(30分)

const INSTRUCTIONS =
  "日本の仏教寺院の検索道具。寺探しは search_temples、1つの寺の詳細は get_temple、" +
  "坐禅会・写経・宿坊・縁日などは find_experiences、日付で行事を探すときは upcoming_events。" +
  "体験・行事の日時は変わることがあるので、回答では出典(sources)と確認日(checked)を示し、" +
  "お出かけ前に寺へ確認するよう添えてください。";

// ---------------------------------------------------------------- データ

let cache = null;

async function loadData(env) {
  if (cache && Date.now() - cache.t < CACHE_MS && cache.base === siteUrl(env)) return cache;
  const base = siteUrl(env);
  const get = async (name, optional) => {
    const r = await fetch(base + "data/" + name, { cf: { cacheTtl: 600 } });
    if (!r.ok) {
      if (optional) return null;
      throw new Error(`${name} を読み込めませんでした(HTTP ${r.status})`);
    }
    return r.json();
  };
  const [temples, sects, exp] = await Promise.all([get("temples.json"), get("sects.json"), get("experiences.json", true)]);
  const F = Object.fromEntries(temples.fields.map((f, i) => [f, i]));
  const ex = exp || { types: {}, items: [] };
  cache = {
    t: Date.now(), base, rows: temples.rows, F, meta: temples, sects: sects.sects,
    tiers: Object.fromEntries(sects.tiers.map((t) => [t.tier, t.name])),
    exp: ex, expById: Object.fromEntries(ex.items.map((it) => [it.id, it])),
    byId: F.id !== undefined ? new Map(temples.rows.map((r) => [r[F.id], r])) : new Map(),
  };
  return cache;
}

function siteUrl(env) {
  const u = (env && env.TEMPLE_SITE_URL) || "https://kenaoyltd.github.io/temple-map/";
  return u.endsWith("/") ? u : u + "/";
}

const v = (D, r, k) => (D.F[k] !== undefined && D.F[k] < r.length ? r[D.F[k]] : "");

// ---------------------------------------------------------------- 日程

const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WD_JA = { mon: "月", tue: "火", wed: "水", thu: "木", fri: "金", sat: "土", sun: "日" };
const TYPE_WORDS = {
  zazen: ["坐禅", "座禅", "禅", "zazen", "坐禪"],
  shakyo: ["写経", "寫經", "shakyo", "写仏"],
  shukubo: ["宿坊", "宿泊", "泊", "shukubo", "住宿"],
  shojin: ["精進料理", "精進", "shojin", "素斋", "素食"],
  ennichi: ["縁日", "市", "ennichi", "庙会"],
  festival: ["大祭", "行事", "祭", "法要", "festival"],
  taiken: ["体験", "taiken", "体验"],
};

function typeOf(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return [];
  if (TYPE_WORDS[w]) return [w];
  const hits = Object.keys(TYPE_WORDS).filter((k) => TYPE_WORDS[k].some((x) => x.toLowerCase().includes(w) || w.includes(x.toLowerCase())));
  if (hits.includes("ennichi") && !hits.includes("festival")) hits.push("festival");
  return hits;
}

function describe(s) {
  if (!s) return "";
  if (s.daily) return "通年";
  if (s.weekly) return "毎週" + s.weekly.map((w) => WD_JA[w]).join("・") + "曜";
  if (s.monthly_days) return "毎月" + s.monthly_days.join("・") + "日";
  if (s.monthly_nth) return "毎月" + s.monthly_nth.map((x) => `第${x.n}${WD_JA[x.weekday]}曜`).join("・");
  if (s.annual) return "毎年" + s.annual.map((a) => `${a.month}月${a.day}日` + ((a.days || 1) > 1 ? `〜${a.day + a.days - 1}日` : "")).join("・");
  return s.text || "";
}

// 日付は日本時間の年月日を UTC の Date として扱う(時差の影響を受けないように)
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const wdKey = (d) => WD[(d.getUTCDay() + 6) % 7];
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function todayJST() {
  const n = new Date(Date.now() + 9 * 3600000);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function occurs(s, d) {
  if (!s || s.daily || (s.text && Object.keys(s).length === 1)) return null;
  if (s.weekly) return s.weekly.includes(wdKey(d));
  if (s.monthly_days) return s.monthly_days.includes(d.getUTCDate());
  if (s.monthly_nth) return s.monthly_nth.some((x) => x.weekday === wdKey(d) && Math.floor((d.getUTCDate() - 1) / 7) + 1 === x.n);
  if (s.annual) {
    return s.annual.some((a) => {
      const y = d.getUTCFullYear();
      const st = new Date(Date.UTC(y, a.month - 1, Math.min(a.day, daysIn(y, a.month))));
      return d >= st && d < addDays(st, a.days || 1);
    });
  }
  return null;
}

function nextDates(s, start, days, limit = 100) {
  const out = [];
  for (let i = 0; i < days && out.length < limit; i++) {
    const d = addDays(start, i);
    if (occurs(s, d)) out.push(d);
  }
  return out;
}

function parseDate(s) {
  s = String(s || "").trim();
  if (!s) return todayJST();
  const m = s.replace(/[年月/]/g, "-").replace(/日/g, "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d) || d.getUTCDate() !== +m[3] ? null : d;
}

// ---------------------------------------------------------------- 整形・検索

const PREFS = ("北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 " +
  "山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 " +
  "徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県").split(" ");

const pkey = (p) => { p = String(p || "").trim(); return p.length >= 3 && "都府県".includes(p.at(-1)) ? p.slice(0, -1) : p; };

function prefMatch(want, addr, region = "") {
  if (!want) return true;
  const w = pkey(want);
  const a = String(addr || "").replace(/^(〒?\s*\d{3}-?\d{4}\s*|日本[、,\s]*)/, "");
  for (const p of PREFS) {
    const k = pkey(p);
    if (a.startsWith(p) || (k.length >= 2 && a.startsWith(k) && ["市", "郡", ""].includes(a.slice(k.length, k.length + 1)))) return k === w;
  }
  return pkey(region) === w;
}

const norm = (s) => String(s || "").replace(/[\s・()（）「」『』]/g, "")
  .replace(/佛/g, "仏").replace(/峯/g, "峰").replace(/龍/g, "竜").replace(/國/g, "国").replace(/圓/g, "円").replace(/總/g, "総");

function distKm(aLat, aLon, bLat, bLon) {
  const k = Math.PI / 180;
  const x = (bLon - aLon) * k * Math.cos(((aLat + bLat) / 2) * k);
  return 6371 * Math.hypot(x, (bLat - aLat) * k);
}

function expShort(D, it, start) {
  const o = { type: D.exp.types[it.type] || it.type, title: it.title, schedule: describe(it.schedule) };
  for (const k of ["time", "fee", "reservation", "note"]) if (it[k]) o[k] = it[k];
  const nx = nextDates(it.schedule, start || todayJST(), 400, 3);
  if (nx.length) o.next_dates = nx.map(ymd);
  o.sources = it.sources || [];
  o.checked = it.checked || "";
  return o;
}

function templeShort(D, r, dist, base) {
  const s = D.sects[v(D, r, "sect")] || { key: "unknown", name: "" };
  const tid = v(D, r, "id");
  const o = {
    id: tid, name: v(D, r, "name"),
    sect: v(D, r, "branch") || (s.key !== "unknown" ? s.name : "不明"),
    rank: v(D, r, "rank") || D.tiers[v(D, r, "tier")] || "",
    address: v(D, r, "addr"), lat: v(D, r, "lat"), lon: v(D, r, "lon"),
  };
  if (v(D, r, "pref")) o.prefecture = v(D, r, "pref");
  if (v(D, r, "year")) o.founded = v(D, r, "year");
  if (v(D, r, "honzon")) o.honzon = v(D, r, "honzon");
  const exps = (v(D, r, "exp") || []).filter((x) => D.expById[x]).map((x) => D.expById[x].title);
  if (exps.length) o.experiences = exps;
  if (dist != null) o.distance_km = Math.round(dist * 100) / 100;
  o.map_url = `${base}?t=${encodeURIComponent(tid)}#16/${o.lat}/${o.lon}`;
  return o;
}

function findTemple(D, q0) {
  if (D.byId.has(q0)) return D.byId.get(q0);
  const q = norm(q0);
  if (!q) return null;
  let hits = D.rows.filter((r) => norm(v(D, r, "name")) === q);
  if (!hits.length) hits = D.rows.filter((r) => norm(v(D, r, "name")).includes(q));
  hits.sort((a, b) => v(D, a, "tier") - v(D, b, "tier") || v(D, a, "kind") - v(D, b, "kind"));
  if (hits.length) return hits[0];
  // 通称(例: とげぬき地蔵)は体験・行事データの別名から探す
  for (const it of D.exp.items) {
    if (D.byId.has(it.temple_id) && [it.temple, ...(it.aliases || [])].some((n) => norm(n).includes(q))) return D.byId.get(it.temple_id);
  }
  return null;
}

const TYPE_ERR = (w) => ({ error: `体験の種類「${w}」が分かりません。坐禅・写経・宿坊・精進料理・縁日・行事・体験のどれかで指定してください。` });

// ---------------------------------------------------------------- 道具

const TOOLS = {
  search_temples: {
    description: "日本の仏教寺院を探す。条件はすべて省略可で組み合わせられる。現在地(lat, lon)を渡すと radius_km 以内を近い順に返す。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "寺の名前の一部(例: 善光寺、達磨)" },
        prefecture: { type: "string", description: "都道府県(例: 群馬県、京都)" },
        city: { type: "string", description: "市区町村(例: 高崎市)" },
        sect: { type: "string", description: "宗派(例: 曹洞宗、臨済宗、浄土真宗、日蓮)" },
        experience: { type: "string", description: "体験・行事の種類(坐禅 / 写経 / 宿坊 / 精進料理 / 縁日 / 行事 / 体験)" },
        lat: { type: "number", description: "現在地の緯度" },
        lon: { type: "number", description: "現在地の経度" },
        radius_km: { type: "number", description: "現在地からの距離(km、既定10)" },
        limit: { type: "integer", description: "最大件数(既定20、最大100)" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, D, base) {
      const kw = norm(a.keyword), cty = String(a.city || "").trim(), sec = norm(a.sect);
      const types = typeOf(a.experience);
      if (a.experience && !types.length) return TYPE_ERR(a.experience);
      const expIds = new Set(D.exp.items.filter((it) => types.includes(it.type)).map((it) => it.id));
      const hasPos = typeof a.lat === "number" && typeof a.lon === "number";
      const radius = typeof a.radius_km === "number" ? a.radius_km : 10;
      const res = [];
      for (const r of D.rows) {
        const name = v(D, r, "name");
        if (!name) continue;
        if (kw && !norm(name).includes(kw)) continue;
        const addr = v(D, r, "addr") || "";
        if (a.prefecture && !prefMatch(a.prefecture, v(D, r, "pref") || addr, D.meta.region)) continue;
        if (cty && !addr.includes(cty)) continue;
        if (sec) {
          const s = D.sects[v(D, r, "sect")] || {};
          if (!norm(v(D, r, "branch")).includes(sec) && !norm(s.name).includes(sec) && !norm(s.detail).includes(sec)) continue;
        }
        if (types.length && !(v(D, r, "exp") || []).some((x) => expIds.has(x))) continue;
        let dist = null;
        if (hasPos) {
          dist = distKm(a.lat, a.lon, v(D, r, "lat"), v(D, r, "lon"));
          if (dist > radius) continue;
        }
        res.push([dist, r]);
      }
      if (hasPos) res.sort((x, y) => x[0] - y[0]);
      else res.sort((x, y) => (v(D, y[1], "exp") || []).length - (v(D, x[1], "exp") || []).length
        || v(D, x[1], "tier") - v(D, y[1], "tier") || v(D, x[1], "kind") - v(D, y[1], "kind")
        || String(v(D, x[1], "name")).localeCompare(String(v(D, y[1], "name")), "ja"));
      const limit = Math.max(1, Math.min(parseInt(a.limit ?? 20, 10) || 20, 100));
      const out = { region: D.meta.region, data_updated: D.meta.generated, total: res.length,
        results: res.slice(0, limit).map(([d, r]) => templeShort(D, r, d, base)) };
      if (types.length && !res.length) {
        const outside = D.exp.items.filter((it) => types.includes(it.type) && !it.temple_id);
        if (outside.length) out.note = "地図の収録地域外にも情報があります: " + outside.slice(0, 10).map((it) => `${it.temple}(${it.pref})${it.title}`).join("、");
      }
      return out;
    },
  },

  get_temple: {
    description: "1つの寺の詳しい情報。体験・行事の次の開催日、出典、寺のページのURLを含む。",
    inputSchema: {
      type: "object",
      properties: { temple: { type: "string", description: "寺ID(search_temples の id)、または寺の名前・通称" } },
      required: ["temple"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, D, base) {
      const r = findTemple(D, String(a.temple || ""));
      if (!r) return { error: `「${a.temple}」は見つかりませんでした(収録地域: ${D.meta.region})。` };
      const o = templeShort(D, r, null, base);
      for (const [k, label] of [["sango", "山号"], ["founder", "開山・開基"], ["chuko", "中興"], ["fuda", "札所"], ["bunka", "文化財"], ["tel", "電話"], ["web", "公式サイト"]]) {
        if (v(D, r, k)) o[label] = v(D, r, k);
      }
      const fl = String(v(D, r, "flags") || "").split("|").filter(Boolean);
      if (fl.length) o.tags = fl;
      if (v(D, r, "wp")) o.wikipedia = "https://ja.wikipedia.org/wiki/" + encodeURIComponent(v(D, r, "wp"));
      const exps = (v(D, r, "exp") || []).filter((x) => D.expById[x]).map((x) => D.expById[x]);
      if (exps.length) o.experiences = exps.map((it) => expShort(D, it));
      o.page_url = `${base}t/${encodeURIComponent(o.id)}.html`;
      o.note = "宗派・創建年などは OpenStreetMap / Wikidata / Wikipedia から自動で集めた情報で、誤りを含むことがあります。";
      return o;
    },
  },

  find_experiences: {
    description: "坐禅会・写経・宿坊・精進料理・縁日・行事などの一覧(手入力・出典つき)。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "種類(坐禅 / 写経 / 宿坊 / 精進料理 / 縁日 / 行事 / 体験)。空ならすべて" },
        prefecture: { type: "string", description: "都道府県(例: 神奈川県)" },
        keyword: { type: "string", description: "寺の名前や行事名の一部" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, D, base) {
      const types = typeOf(a.type);
      if (a.type && !types.length) return TYPE_ERR(a.type);
      const kw = norm(a.keyword);
      const out = [];
      for (const it of D.exp.items) {
        if (types.length && !types.includes(it.type)) continue;
        if (a.prefecture && !prefMatch(a.prefecture, it.pref)) continue;
        if (kw && !norm(it.temple + it.title + (it.aliases || []).join("")).includes(kw)) continue;
        const o = { temple: it.temple, prefecture: it.pref || "", ...expShort(D, it) };
        if (it.temple_id) { o.temple_id = it.temple_id; o.page_url = `${base}t/${encodeURIComponent(it.temple_id)}.html`; }
        out.push(o);
      }
      return { total: out.length, results: out, note: "手入力の情報です。日時は変わることがあるため、出典と確認日を添え、寺への確認を勧めてください。" };
    },
  },

  upcoming_events: {
    description: "期間内に開催される縁日・坐禅会・行事を日付順に返す(定期開催の日程から計算した予定日)。",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "開始日(例: 2026-12-01。空なら今日・日本時間)" },
        days: { type: "integer", description: "何日分か(既定30、最大366)" },
        prefecture: { type: "string", description: "都道府県で絞り込み" },
        type: { type: "string", description: "種類で絞り込み(坐禅 / 縁日 / 行事 など)" },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(a, D) {
      const start = parseDate(a.start_date);
      if (!start) return { error: `日付「${a.start_date}」が読めません。2026-12-01 の形で指定してください。` };
      const days = Math.max(1, Math.min(parseInt(a.days ?? 30, 10) || 30, 366));
      const types = typeOf(a.type);
      if (a.type && !types.length) return TYPE_ERR(a.type);
      const ev = [];
      for (const it of D.exp.items) {
        if (types.length && !types.includes(it.type)) continue;
        if (a.prefecture && !prefMatch(a.prefecture, it.pref)) continue;
        for (const d of nextDates(it.schedule, start, days)) {
          ev.push({ date: ymd(d), weekday: WD_JA[wdKey(d)], temple: it.temple, prefecture: it.pref || "", title: it.title,
            type: D.exp.types[it.type] || it.type, ...(it.time ? { time: it.time } : {}),
            source: (it.sources || [""])[0], checked: it.checked || "" });
        }
      }
      ev.sort((x, y) => x.date.localeCompare(y.date) || x.temple.localeCompare(y.temple, "ja"));
      return { from: ymd(start), to: ymd(addDays(start, days - 1)), total: ev.length, events: ev.slice(0, 300),
        note: "定期開催の日程から計算した予定日です。臨時の中止・変更は反映されないため、寺への確認を勧めてください。" };
    },
  },
};

// ---------------------------------------------------------------- MCP(JSON-RPC over HTTP)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRpc(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg && msg.id, -32600, "Invalid Request");
  const isNote = msg.id === undefined;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const ver = PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0];
      return ok({ protocolVersion: ver, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
    case "tools/call": {
      const t = TOOLS[p.name];
      if (!t) return rpcErr(msg.id, -32602, `Unknown tool: ${p.name}`);
      try {
        const D = await loadData(env);
        const out = await t.run(p.arguments || {}, D, siteUrl(env));
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }], isError: !!out.error });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `データの読み込みに失敗しました: ${e.message}` }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNote ? null : rpcErr(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      if (request.method === "GET") return new Response("このサーバーはPOSTのみ対応です(SSEなし)", { status: 405, headers: { Allow: "POST", ...CORS } });
      if (request.method === "DELETE") return new Response(null, { status: 405, headers: CORS });
      if (request.method !== "POST") return new Response(null, { status: 405, headers: CORS });
      let body;
      try { body = await request.json(); } catch { return json(rpcErr(null, -32700, "Parse error"), 400); }
      if (Array.isArray(body)) {
        const outs = (await Promise.all(body.map((m) => handleRpc(m, env)))).filter(Boolean);
        return outs.length ? json(outs) : new Response(null, { status: 202, headers: CORS });
      }
      const out = await handleRpc(body, env);
      return out ? json(out) : new Response(null, { status: 202, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "") {
      const base = siteUrl(env);
      return new Response(
        `日本の寺院マップ MCP サーバー\n\n接続先(MCP Streamable HTTP): ${url.origin}/mcp\n道具: ${Object.keys(TOOLS).join(", ")}\nデータ: ${base}\n`,
        { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
    }
    return new Response("Not Found", { status: 404, headers: CORS });
  },
};
