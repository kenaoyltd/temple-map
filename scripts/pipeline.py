#!/usr/bin/env python3
"""
全国の仏教寺院データを取得・統合して site/data/temples.json を作る。

使い方:
  python scripts/pipeline.py all           # 取得 → 統合 まで全部
  python scripts/pipeline.py fetch         # 取得だけ(raw/ に保存)
  python scripts/pipeline.py build         # raw/ から統合だけ

環境変数:
  REGION   対象地域。「全国」(既定)または都道府県名(例: 群馬県)
  REFRESH  1 なら raw/ に既存データがあっても取り直す(既定 1)
"""
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import classify as C  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("RAW_DIR", ROOT / "raw"))
OUT = ROOT / "site" / "data" / "temples.json"
REGION = os.environ.get("REGION", "全国").strip() or "全国"
REFRESH = os.environ.get("REFRESH", "1") == "1"
REPO = os.environ.get("GITHUB_REPOSITORY", "local")
UA = f"japan-temple-map/1.0 (https://github.com/{REPO})"

S = requests.Session()
S.headers["User-Agent"] = UA

OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
WDQS = "https://query.wikidata.org/sparql"
WD_API = "https://www.wikidata.org/w/api.php"
JAWP_API = "https://ja.wikipedia.org/w/api.php"
BUDDHIST_TEMPLE = "Q5393308"   # Wikidata: 仏教寺院
JAPAN = "Q17"


def log(*a):
    print(*a, flush=True)


def save(name, obj):
    RAW.mkdir(exist_ok=True)
    (RAW / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def load(name):
    p = RAW / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def fresh(name):
    return (RAW / name).exists() and not REFRESH


# ---------------------------------------------------------------- OSM
def overpass(query):
    last = None
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            r = S.post(url, data={"data": query}, timeout=900)
            if r.status_code == 200:
                return r.json()
            last = f"{url} HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last = f"{url} {e}"
        log("  Overpass 再試行:", last)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError("Overpass に接続できませんでした: " + str(last))


def fetch_osm():
    if fresh("osm.json"):
        log("OSM: 既存データを使用")
        return
    sel = '["amenity"="place_of_worship"]["religion"="buddhist"]'
    elements = {}
    if REGION == "全国":
        # 日本を緯度帯で分けて取得(1回の応答が大きくなりすぎないように)
        bands = [(20, 32), (32, 34), (34, 34.8), (34.8, 35.5), (35.5, 36.3), (36.3, 38), (38, 40.5), (40.5, 46)]
        for s, n in bands:
            q = f"""[out:json][timeout:800][maxsize:2000000000];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
nwr{sel}(area.jp)({s},122,{n},154);
out center tags;"""
            log(f"OSM: 北緯{s}〜{n}度 を取得中…")
            data = overpass(q)
            for el in data.get("elements", []):
                elements[f"{el['type'][0]}{el['id']}"] = el
            log(f"  累計 {len(elements)} 件")
            time.sleep(10)
    else:
        q = f"""[out:json][timeout:800];
area["name"="{REGION}"]["admin_level"="4"]->.pref;
nwr{sel}(area.pref);
out center tags;"""
        log(f"OSM: {REGION} を取得中…")
        data = overpass(q)
        for el in data.get("elements", []):
            elements[f"{el['type'][0]}{el['id']}"] = el
    if not elements:
        raise RuntimeError(f"OSM から寺院が1件も取れませんでした(REGION={REGION} の綴りを確認してください)")
    save("osm.json", list(elements.values()))
    log(f"OSM: 合計 {len(elements)} 件")


# ---------------------------------------------------------------- Wikidata
def sparql(q):
    for attempt in range(4):
        try:
            r = S.get(WDQS, params={"query": q, "format": "json"}, timeout=120,
                      headers={"Accept": "application/sparql-results+json"})
            if r.status_code == 200:
                return r.json()["results"]["bindings"]
            if r.status_code in (429, 503):
                time.sleep(int(r.headers.get("Retry-After", 30)))
                continue
            return None  # タイムアウト(500)などは呼び出し側で領域を分割
        except Exception:  # noqa: BLE001
            time.sleep(10)
    return None


def box_query(s, w, n, e):
    return f"""SELECT ?item ?itemLabel ?coord ?inception ?founderLabel ?religionLabel ?article WHERE {{
  SERVICE wikibase:box {{
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point({w} {s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point({e} {n})"^^geo:wktLiteral .
  }}
  ?item wdt:P31/wdt:P279* wd:{BUDDHIST_TEMPLE} .
  ?item wdt:P17 wd:{JAPAN} .
  OPTIONAL {{ ?item wdt:P571 ?inception }}
  OPTIONAL {{ ?item wdt:P112 ?founder }}
  OPTIONAL {{ ?item wdt:P140 ?religion }}
  OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja,en". }}
}}"""


def collect_box(s, w, n, e, depth, rows):
    res = sparql(box_query(s, w, n, e))
    if res is None:
        if depth >= 4:
            log(f"  Wikidata: 範囲 {s:.2f},{w:.2f} を取得できずスキップ")
            return
        ms, mw = (s + n) / 2, (w + e) / 2
        for bb in [(s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)]:
            collect_box(*bb, depth + 1, rows)
        return
    rows.extend(res)
    time.sleep(1)


def fetch_wikidata():
    if fresh("wikidata.json"):
        log("Wikidata: 既存データを使用")
        return
    osm = load("osm.json") or []
    pts = [(el.get("lat") or el.get("center", {}).get("lat"), el.get("lon") or el.get("center", {}).get("lon")) for el in osm]
    pts = [p for p in pts if p[0] and p[1]]
    if REGION == "全国":
        bbox = (20, 122, 46, 154)
    else:
        bbox = (min(p[0] for p in pts) - 0.02, min(p[1] for p in pts) - 0.02,
                max(p[0] for p in pts) + 0.02, max(p[1] for p in pts) + 0.02)
    # 寺が無い海上などを飛ばすため、OSMの寺がある2度格子だけ問い合わせる
    step = 2.0 if REGION == "全国" else 0.5
    cells = set()
    for lat, lon in pts:
        cells.add((math.floor(lat / step) * step, math.floor(lon / step) * step))
    rows = []
    cells = sorted(cells)
    for i, (s, w) in enumerate(cells):
        s2, w2 = max(s, bbox[0]), max(w, bbox[1])
        n2, e2 = min(s + step, bbox[2]), min(w + step, bbox[3])
        log(f"Wikidata: 区画 {i + 1}/{len(cells)} ({s2:.1f},{w2:.1f})")
        collect_box(s2, w2, n2, e2, 0, rows)

    items = {}
    for r in rows:
        qid = r["item"]["value"].rsplit("/", 1)[-1]
        it = items.setdefault(qid, {"qid": qid, "label": "", "coord": "", "inception": [], "founder": [], "religion": [], "article": ""})
        it["label"] = r.get("itemLabel", {}).get("value", it["label"])
        it["coord"] = r.get("coord", {}).get("value", it["coord"])
        for k, f in [("inception", "inception"), ("founder", "founderLabel"), ("religion", "religionLabel")]:
            v = r.get(f, {}).get("value")
            if v and v not in it[k]:
                it[k].append(v)
        if r.get("article"):
            it["article"] = r["article"]["value"]

    # OSMに wikidata タグがあるのに上の検索で漏れたものを個別取得
    missing = sorted({el.get("tags", {}).get("wikidata") for el in osm} - set(items) - {None, ""})
    missing = [q for q in missing if re.fullmatch(r"Q\d+", q)]
    log(f"Wikidata: OSMから参照されている追加 {len(missing)} 件を取得")
    for i in range(0, len(missing), 50):
        batch = missing[i:i + 50]
        try:
            r = S.get(WD_API, params={"action": "wbgetentities", "ids": "|".join(batch), "format": "json",
                                      "props": "labels|claims|sitelinks", "languages": "ja", "sitefilter": "jawiki",
                                      "maxlag": 5}, timeout=60)
            ents = r.json().get("entities", {})
        except Exception:  # noqa: BLE001
            continue
        for qid, ent in ents.items():
            if "missing" in ent:
                continue
            cl = ent.get("claims", {})

            def vals(p):
                out = []
                for c in cl.get(p, []):
                    dv = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                    if isinstance(dv, dict) and "time" in dv:
                        out.append(dv["time"])
                return out
            title = ent.get("sitelinks", {}).get("jawiki", {}).get("title", "")
            items[qid] = {"qid": qid, "label": ent.get("labels", {}).get("ja", {}).get("value", ""), "coord": "",
                          "inception": vals("P571"), "founder": [], "religion": [],
                          "article": ("https://ja.wikipedia.org/wiki/" + title.replace(" ", "_")) if title else ""}
        time.sleep(1)
    save("wikidata.json", list(items.values()))
    log(f"Wikidata: 合計 {len(items)} 件")


# ---------------------------------------------------------------- Wikipedia
def wp_title_from_url(u):
    from urllib.parse import unquote
    return unquote(u.rsplit("/wiki/", 1)[-1]).replace("_", " ")


def fetch_ranked():
    """Wikipedia で「寺格」に本山・門跡などが書かれている寺院記事を全国から探す"""
    if fresh("ranked.json"):
        log("寺格のある寺院: 既存データを使用")
        return
    queries = [
        'hastemplate:"日本の寺院" insource:/寺格 *= *[^|\\n]*(本山|門跡|本寺|勅願|別院|由緒)/',
        'hastemplate:"日本の寺院" insource:"寺格" 本山',
    ]
    titles = []
    for q in queries:
        offset = 0
        ok = False
        while offset is not None and offset < 5000:
            try:
                r = S.get(JAWP_API, params={"action": "query", "list": "search", "srsearch": q, "srnamespace": 0,
                                            "srlimit": 500, "sroffset": offset, "srprop": "", "format": "json",
                                            "formatversion": 2, "maxlag": 5}, timeout=60)
                j = r.json()
            except Exception as e:  # noqa: BLE001
                log("  検索エラー:", e)
                break
            if "error" in j:
                log("  検索エラー:", j["error"].get("info", ""))
                break
            ok = True
            titles += [x["title"] for x in j.get("query", {}).get("search", [])]
            offset = j.get("continue", {}).get("sroffset")
            time.sleep(1)
        if ok and titles:
            break
    titles = sorted(set(titles))
    log(f"寺格のある寺院記事: {len(titles)} 件")
    save("ranked.json", titles)


def fetch_muju():
    """Wikipedia で「無住」の記述がある寺院記事を探す"""
    if fresh("muju.json"):
        log("無住の記述: 既存データを使用")
        return
    titles, offset = [], 0
    while offset is not None and offset < 3000:
        try:
            j = S.get(JAWP_API, params={"action": "query", "list": "search", "srnamespace": 0, "srlimit": 500,
                                        "srsearch": 'hastemplate:"日本の寺院" insource:"無住"', "sroffset": offset,
                                        "srprop": "", "format": "json", "formatversion": 2, "maxlag": 5}, timeout=60).json()
        except Exception as e:  # noqa: BLE001
            log("  検索エラー:", e)
            break
        titles += [x["title"] for x in j.get("query", {}).get("search", [])]
        offset = j.get("continue", {}).get("sroffset")
        time.sleep(1)
    log(f"無住の記述がある寺院記事: {len(titles)} 件")
    save("muju.json", sorted(set(titles)))


def fetch_wikipedia():
    if fresh("wikipedia2.json"):
        log("Wikipedia: 既存データを使用")
        return
    titles = set(load("ranked.json") or [])
    for it in load("wikidata.json") or []:
        if it.get("article"):
            titles.add(wp_title_from_url(it["article"]))
    for el in load("osm.json") or []:
        wp = el.get("tags", {}).get("wikipedia", "")
        if wp.startswith("ja:"):
            titles.add(wp[3:].replace("_", " "))
    heads = json.loads((ROOT / "data" / "head_temples.json").read_text(encoding="utf-8"))["temples"]
    for h in heads:
        titles.add(h.get("wp") or h["name"])
    titles = sorted(titles)
    log(f"Wikipedia: {len(titles)} 記事の冒頭と情報欄を取得")
    pages = {}
    for i in range(0, len(titles), 20):
        batch = titles[i:i + 20]
        for attempt in range(3):
            try:
                r = S.get(JAWP_API, params={"action": "query", "prop": "extracts|revisions|coordinates",
                                            "exintro": 1, "explaintext": 1, "exlimit": 20,
                                            "rvprop": "content", "rvslots": "main", "rvsection": 0,
                                            "redirects": 1, "titles": "|".join(batch),
                                            "format": "json", "formatversion": 2, "maxlag": 5}, timeout=60)
                q = r.json().get("query", {})
                back = {}
                for x in q.get("normalized", []):
                    back[x["to"]] = x["from"]
                for x in q.get("redirects", []):
                    back[x["to"]] = back.get(x["from"], x["from"])
                for p in q.get("pages", []):
                    t = p.get("title", "")
                    if p.get("missing"):
                        continue
                    revs = p.get("revisions") or [{}]
                    wt = revs[0].get("slots", {}).get("main", {}).get("content", "")
                    co = (p.get("coordinates") or [{}])[0]
                    rec = {"title": t, "text": (p.get("extract") or "")[:700], "wikitext": wt[:6000],
                           "lat": co.get("lat"), "lon": co.get("lon")}
                    pages[t] = rec
                    if t in back:
                        pages[back[t]] = rec
                break
            except Exception:  # noqa: BLE001
                time.sleep(5)
        if (i // 20) % 50 == 0:
            log(f"  {min(i + 20, len(titles))}/{len(titles)}")
        time.sleep(0.3)
    save("wikipedia2.json", pages)


# ---------------------------------------------------------------- 統合
PREFS = ("北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 "
         "山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 "
         "徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県").split()


def outside_region(text):
    """地域モードで、説明文が別の都道府県を指していれば True"""
    if REGION == "全国" or not text:
        return False
    head = text[:200]
    if REGION in head or REGION.rstrip("都府県") in head[:60]:
        return False
    return any(p in head for p in PREFS if p != REGION)


def dist_m(a_lat, a_lon, b_lat, b_lon):
    k = 111_320
    return math.hypot((a_lat - b_lat) * k, (a_lon - b_lon) * k * math.cos(math.radians(a_lat)))


def norm_name(n):
    n = re.sub(r"[\s・()（）「」『』]", "", n or "")
    return n.replace("佛", "仏").replace("峯", "峰").replace("龍", "竜").replace("國", "国").replace("圓", "円").replace("總", "総")


def parse_point(wkt):
    m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", wkt or "")
    return (float(m.group(2)), float(m.group(1))) if m else (None, None)


class Grid:
    """近くの点を素早く探すための格子"""
    def __init__(self, cell=0.01):
        self.cell, self.g = cell, {}

    def key(self, lat, lon):
        return (int(lat / self.cell), int(lon / self.cell))

    def add(self, lat, lon, obj):
        self.g.setdefault(self.key(lat, lon), []).append(obj)

    def near(self, lat, lon, r=1):
        ky, kx = self.key(lat, lon)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                yield from self.g.get((ky + dy, kx + dx), [])


def build():
    osm = load("osm.json") or []
    wd = {it["qid"]: it for it in (load("wikidata.json") or [])}
    wp = load("wikipedia2.json") or {}
    ranked = load("ranked.json") or []
    muju = set(load("muju.json") or [])
    sects = json.loads((ROOT / "data" / "sects.json").read_text(encoding="utf-8"))
    heads = json.loads((ROOT / "data" / "head_temples.json").read_text(encoding="utf-8"))["temples"]
    sect_keys = [s["key"] for s in sects["sects"]]

    temples = []
    grid = Grid()
    used_qids = set()

    def make(lat, lon, name, tags=None, qid="", osm_id=""):
        return {"lat": lat, "lon": lon, "name": name or "", "tags": tags or {}, "qid": qid, "osm": osm_id}

    # 1) OSM(重複:同名で150m以内の点は1つにまとめる)
    for el in osm:
        tags = el.get("tags", {})
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        name = tags.get("name:ja") or tags.get("name") or ""
        t = make(lat, lon, name, tags, tags.get("wikidata", ""), f"{el['type']}/{el['id']}")
        dup = None
        if name:
            nn = norm_name(name)
            for o in grid.near(lat, lon):
                if norm_name(o["name"]) == nn and dist_m(lat, lon, o["lat"], o["lon"]) < 150:
                    dup = o
                    break
        if dup:
            # タグの多い方を残す
            if len(tags) > len(dup["tags"]):
                dup["tags"], dup["osm"] = tags, t["osm"]
            dup["qid"] = dup["qid"] or t["qid"]
            continue
        temples.append(t)
        grid.add(lat, lon, t)
        if t["qid"]:
            used_qids.add(t["qid"])

    # 2) Wikidata をOSMに結びつける(同名・500m以内)。無ければ新規の点として追加
    for qid, it in wd.items():
        if qid in used_qids:
            continue
        lat, lon = parse_point(it.get("coord"))
        if lat is None:
            continue
        nn = norm_name(it.get("label", ""))
        match = None
        for o in grid.near(lat, lon, r=1):
            if o["qid"]:
                continue
            on = norm_name(o["name"])
            if on and nn and (on == nn or on in nn or nn in on) and dist_m(lat, lon, o["lat"], o["lon"]) < 500:
                match = o
                break
        if match:
            match["qid"] = qid
        else:
            if REGION != "全国":
                # 地域モードでは、県内のOSMの寺から5km以上離れたもの・説明文が他県を指すものを除く
                if not any(dist_m(lat, lon, o["lat"], o["lon"]) < 5000 for o in grid.near(lat, lon, r=5)):
                    continue
                art = it.get("article")
                if art and outside_region((wp.get(wp_title_from_url(art)) or {}).get("text", "")):
                    continue
            t = make(lat, lon, it.get("label", ""), {}, qid, "")
            temples.append(t)
            grid.add(lat, lon, t)
        used_qids.add(qid)

    # 2b) 寺格のある寺院記事(全国検索の結果)を結びつける。無ければ新規の点として追加
    title_used = set()
    for t in temples:
        if t["qid"] and wd.get(t["qid"], {}).get("article"):
            title_used.add(wp_title_from_url(wd[t["qid"]]["article"]))
        elif t["tags"].get("wikipedia", "").startswith("ja:"):
            title_used.add(t["tags"]["wikipedia"][3:].replace("_", " "))
    for title in ranked:
        page = wp.get(title)
        if not page or page.get("lat") is None or page["title"] in title_used or title in title_used:
            continue
        if C.is_defunct(page.get("text", "")):
            continue
        lat, lon = page["lat"], page["lon"]
        if REGION != "全国" and (outside_region(page.get("text", "")) or
                                 not any(dist_m(lat, lon, o["lat"], o["lon"]) < 5000 for o in grid.near(lat, lon, r=5))):
            continue
        nn = norm_name(re.sub(r"\s*\(.*?\)$", "", page["title"]))
        best, best_d = None, 800
        for o in grid.near(lat, lon, r=1):
            on = norm_name(o["name"])
            if on and nn and (on == nn or on in nn or nn in on):
                d = dist_m(lat, lon, o["lat"], o["lon"])
                if d < best_d and not o.get("wp"):
                    best, best_d = o, d
        if best:
            best["wp"] = page["title"]
        else:
            t = make(lat, lon, re.sub(r"\s*\(.*?\)$", "", page["title"]), {}, "", "")
            t["wp"] = page["title"]
            temples.append(t)
            grid.add(lat, lon, t)
        title_used.add(page["title"])

    # 3) 総本山リストとの照合
    head_for = {}
    for h in heads:
        names = {norm_name(h["name"])} | {norm_name(a) for a in h.get("aliases", [])}
        best, best_d = None, 4000
        for o in grid.near(h["lat"], h["lon"], r=30):
            on = norm_name(o["name"])
            if not on:
                continue
            if on in names or any(n in on for n in names if len(n) >= 2):
                d = dist_m(h["lat"], h["lon"], o["lat"], o["lon"]) + (0 if on in names else 1000)
                if d < best_d:
                    best, best_d = o, d
        if best is not None:
            head_for[id(best)] = h
        elif REGION == "全国":
            t = make(h["lat"], h["lon"], h["name"])
            temples.append(t)
            head_for[id(t)] = h

    # 4) 各寺の属性を決める
    rows = []
    stats = {"total": 0, "sect_known": 0, "year_known": 0, "wp": 0}
    for t in temples:
        tags = t["tags"]
        it = wd.get(t["qid"], {}) if t["qid"] else {}
        title = t.get("wp", "")
        if title:
            pass
        elif it.get("article"):
            title = wp_title_from_url(it["article"])
        elif tags.get("wikipedia", "").startswith("ja:"):
            title = tags["wikipedia"][3:].replace("_", " ")
        ex = wp.get(title, {}) if title else {}
        text = ex.get("text", "")
        if ex.get("title"):
            title = ex["title"]

        ib = {k: C.clean_wiki(v) for k, v in C.parse_infobox(ex.get("wikitext", "")).items()}

        sect, branch = None, ""
        # (0) Wikipedia 情報欄の「宗派」「宗旨」(最も確か)
        for k in ("宗派", "宗旨"):
            v = ib.get(k, "")
            s0 = C.sect_from_ja(v)
            if s0:
                sect, branch = s0, (ib.get("宗派") or v)[:24]
                break
        # (a) OSM の日本語宗派タグ
        if not sect:
            for k in ("denomination:ja", "sect", "denomination:jp", "religion:ja", "operator"):
                v = tags.get(k, "")
                s1 = C.sect_from_ja(v)
                if s1:
                    sect, branch = s1, v if re.search(r"(宗|派)$", v) else branch
                    break
        # (b) Wikipedia 冒頭文(「〇〇宗〇〇派の寺院」)
        if text and not ib.get("宗派") and not ib.get("宗旨"):
            s2, b2 = C.sect_from_text(text)
            if s2 and (not sect or b2):
                sect, branch = s2, b2 or branch
        # (c) Wikidata の「宗教」
        if not sect:
            for rl in it.get("religion", []):
                s3 = C.sect_from_ja(rl)
                if s3:
                    sect, branch = s3, rl
                    break
        # (d) OSM の denomination(ローマ字)
        if not sect:
            sect = C.sect_from_romaji(tags.get("denomination", ""))
        sect = sect or "unknown"

        # 寺格:情報欄の「寺格」→ 冒頭文
        rank = ib.get("寺格", "")[:30]
        tier = C.tier_from_rank(rank)
        if not rank:
            tier, rank = C.rank_from_text(text)

        # 創建年:情報欄 → Wikidata → 冒頭文
        year, ysrc, ytext, legend = None, "", "", False
        if ib.get("創建年"):
            ytext = ib["創建年"][:40]
            y, legend = C.year_from_field(ytext)
            if y:
                year, ysrc = y, "ib"
        if year is None:
            for v in it.get("inception", []):
                y = C.year_from_wikidata(v)
                if y and (year is None or y < year):
                    year, ysrc = y, "wd"
        if year is None:
            y = C.year_from_text(text)
            if y:
                year, ysrc = y, "wp"
        founder = "、".join(x for x in [ib.get("開山") and "開山 " + ib["開山"], ib.get("開基") and "開基 " + ib["開基"]] if x)
        if not founder:
            founder = "、".join(it.get("founder", [])[:2])
        fuda = ib.get("札所等", "")
        bunka = ib.get("文化財", "")
        flags = C.flags_of(fuda, bunka, rank, text)
        honzon = ib.get("本尊", "")
        sango = ib.get("山号", "")
        chuko = ib.get("中興", "")

        # 無住:Wikipedia に記述あり / OSM の説明に記述あり
        if title in muju or re.search(r"無住", " ".join(tags.get(k, "") for k in ("description", "note", "description:ja"))):
            flags.append("無住")
        # 電話・公式サイト・所在地
        tel = tags.get("phone") or tags.get("contact:phone") or ""
        web = tags.get("website") or tags.get("contact:website") or tags.get("url") or ""
        if not web:
            m = re.search(r"https?://[^\s|\]}<]+", C.parse_infobox(ex.get("wikitext", "")).get("公式HP", ""))
            web = m.group(0) if m else ""
        addr = ib.get("所在地", "")
        if not addr:
            addr = "".join(tags.get(k, "") for k in ("addr:province", "addr:city", "addr:county", "addr:quarter",
                                                       "addr:suburb", "addr:neighbourhood", "addr:block_number",
                                                       "addr:housenumber")) or tags.get("addr:full", "")
        if not addr and text:
            m = re.search(r"((?:" + "|".join(PREFS) + r")[^、。にの]{1,14}?(?:市|郡[^、。]{1,6}?[町村]|町|村|区))", text[:120])
            addr = m.group(1) if m else ""

        h = head_for.get(id(t))
        if h:
            sect, branch, tier = h["sect"], h["branch"], h["tier"]
            rank = rank if C.tier_from_rank(rank) == h["tier"] else h["rank"]
            if h.get("year") and ysrc != "ib":
                year, ysrc = h["year"], "list"
            founder = founder or h.get("founder") or ""
            if not title:
                title = h.get("wp") or h["name"]
            if tier <= 3 and "門跡" in rank and "門跡・勅願" not in flags:
                flags.append("門跡・勅願")

        name = t["name"] or (title if title else "")
        kind = C.kind_of(name)
        stats["total"] += 1
        stats["sect_known"] += sect != "unknown"
        stats["year_known"] += year is not None
        stats["ranked"] = stats.get("ranked", 0) + (tier <= 3)
        stats["flagged"] = stats.get("flagged", 0) + bool(flags)
        stats["wp"] += bool(title)
        rows.append([
            round(t["lon"], 5), round(t["lat"], 5), name,
            sect_keys.index(sect), tier, year if year else 0,
            branch[:24], rank, title, t["qid"], t["osm"], founder[:40],
            {"temple": 0, "hall": 1, "noname": 2}[kind], {"": 0, "wd": 1, "wp": 2, "list": 3, "ib": 4}[ysrc],
            ("|" + "|".join(flags) + "|") if flags else "", fuda[:60], bunka[:120], honzon[:40], sango[:20],
            chuko[:30], ytext, 1 if legend else 0,
            tel[:20], web[:120], addr[:60],
        ])

    rows.sort(key=lambda r: (-r[4], r[2]))  # 寺格の低いものから描く(上位寺院が上に重なる)
    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "region": REGION,
        "stats": stats,
        "fields": ["lon", "lat", "name", "sect", "tier", "year", "branch", "rank", "wp", "wd", "osm", "founder", "kind", "ysrc",
                   "flags", "fuda", "bunka", "honzon", "sango", "chuko", "ytext", "legend",
                   "tel", "web", "addr"],
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT.parent / "sects.json").write_text((ROOT / "data" / "sects.json").read_text(encoding="utf-8"), encoding="utf-8")
    log(f"完成: {stats['total']} 件(宗派判明 {stats['sect_known']} / 創建年判明 {stats['year_known']} / Wikipedia記事あり {stats['wp']}"
        f" / 寺格あり {stats.get('ranked', 0)} / 格式タグあり {stats.get('flagged', 0)})")
    log(f"出力: {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    log(f"対象地域: {REGION}")
    if cmd in ("all", "fetch"):
        fetch_osm()
        fetch_wikidata()
        fetch_ranked()
        fetch_muju()
        fetch_wikipedia()
    if cmd in ("all", "build"):
        build()


if __name__ == "__main__":
    main()
