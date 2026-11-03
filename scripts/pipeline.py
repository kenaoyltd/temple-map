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


def fetch_wikipedia():
    if fresh("wikipedia.json"):
        log("Wikipedia: 既存データを使用")
        return
    titles = set()
    for it in load("wikidata.json") or []:
        if it.get("article"):
            titles.add(wp_title_from_url(it["article"]))
    for el in load("osm.json") or []:
        wp = el.get("tags", {}).get("wikipedia", "")
        if wp.startswith("ja:"):
            titles.add(wp[3:].replace("_", " "))
    titles = sorted(titles)
    log(f"Wikipedia: {len(titles)} 記事の冒頭を取得")
    extracts = {}
    for i in range(0, len(titles), 20):
        batch = titles[i:i + 20]
        for attempt in range(3):
            try:
                r = S.get(JAWP_API, params={"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
                                            "exlimit": 20, "redirects": 1, "titles": "|".join(batch),
                                            "format": "json", "formatversion": 2, "maxlag": 5}, timeout=60)
                q = r.json().get("query", {})
                redirect_map = {x["to"]: x["from"] for x in q.get("redirects", [])}
                norm_map = {x["to"]: x["from"] for x in q.get("normalized", [])}
                for p in q.get("pages", []):
                    t = p.get("title", "")
                    ex = (p.get("extract") or "")[:700]
                    src = redirect_map.get(t, t)
                    src = norm_map.get(src, src)
                    extracts[src] = {"title": t, "text": ex}
                    extracts[t] = {"title": t, "text": ex}
                break
            except Exception:  # noqa: BLE001
                time.sleep(5)
        if (i // 20) % 50 == 0:
            log(f"  {min(i + 20, len(titles))}/{len(titles)}")
        time.sleep(0.3)
    save("wikipedia.json", extracts)


# ---------------------------------------------------------------- 統合
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
    wp = load("wikipedia.json") or {}
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
                # 地域モードでは、OSMの寺から5km以上離れたもの(県外の可能性)を除く
                if not any(dist_m(lat, lon, o["lat"], o["lon"]) < 5000 for o in grid.near(lat, lon, r=5)):
                    continue
            t = make(lat, lon, it.get("label", ""), {}, qid, "")
            temples.append(t)
            grid.add(lat, lon, t)
        used_qids.add(qid)

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
        title = ""
        if it.get("article"):
            title = wp_title_from_url(it["article"])
        elif tags.get("wikipedia", "").startswith("ja:"):
            title = tags["wikipedia"][3:].replace("_", " ")
        ex = wp.get(title, {}) if title else {}
        text = ex.get("text", "")
        if ex.get("title"):
            title = ex["title"]

        sect, branch = None, ""
        # (a) OSM の日本語宗派タグ
        for k in ("denomination:ja", "sect", "denomination:jp", "religion:ja", "operator"):
            v = tags.get(k, "")
            s = C.sect_from_ja(v)
            if s:
                sect, branch = s, v if re.search(r"(宗|派)$", v) else branch
                break
        # (b) Wikipedia 冒頭文(「〇〇宗〇〇派の寺院」)
        if text:
            s2, b2 = C.sect_from_text(text)
            if s2 and (not sect or b2):
                sect, branch = s2, b2 or branch
        # (c) Wikidata の「宗教」
        if not sect:
            for rl in it.get("religion", []):
                s = C.sect_from_ja(rl)
                if s:
                    sect, branch = s, rl
                    break
        # (d) OSM の denomination(ローマ字)
        if not sect:
            sect = C.sect_from_romaji(tags.get("denomination", ""))
        sect = sect or "unknown"

        tier, rank = C.rank_from_text(text)
        year, ysrc = None, ""
        for v in it.get("inception", []):
            y = C.year_from_wikidata(v)
            if y and (year is None or y < year):
                year, ysrc = y, "wd"
        if year is None:
            y = C.year_from_text(text)
            if y:
                year, ysrc = y, "wp"
        founder = "、".join(it.get("founder", [])[:2])

        h = head_for.get(id(t))
        if h:
            sect, branch, rank, tier = h["sect"], h["branch"], h["rank"], h["tier"]
            if h.get("year"):
                year, ysrc = h["year"], "list"
            founder = h.get("founder") or founder
            if not title:
                title = h.get("wp") or h["name"]

        name = t["name"] or (title if title else "")
        kind = C.kind_of(name)
        stats["total"] += 1
        stats["sect_known"] += sect != "unknown"
        stats["year_known"] += year is not None
        stats["wp"] += bool(title)
        rows.append([
            round(t["lon"], 5), round(t["lat"], 5), name,
            sect_keys.index(sect), tier, year if year else 0,
            branch[:24], rank, title, t["qid"], t["osm"], founder[:40],
            {"temple": 0, "hall": 1, "noname": 2}[kind], {"": 0, "wd": 1, "wp": 2, "list": 3}[ysrc],
        ])

    rows.sort(key=lambda r: (-r[4], r[2]))  # 寺格の低いものから描く(上位寺院が上に重なる)
    out = {
        "generated": time.strftime("%Y-%m-%d"),
        "region": REGION,
        "stats": stats,
        "fields": ["lon", "lat", "name", "sect", "tier", "year", "branch", "rank", "wp", "wd", "osm", "founder", "kind", "ysrc"],
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT.parent / "sects.json").write_text((ROOT / "data" / "sects.json").read_text(encoding="utf-8"), encoding="utf-8")
    log(f"完成: {stats['total']} 件(宗派判明 {stats['sect_known']} / 創建年判明 {stats['year_known']} / Wikipedia記事あり {stats['wp']})")
    log(f"出力: {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    log(f"対象地域: {REGION}")
    if cmd in ("all", "fetch"):
        fetch_osm()
        fetch_wikidata()
        fetch_wikipedia()
    if cmd in ("all", "build"):
        build()


if __name__ == "__main__":
    main()
