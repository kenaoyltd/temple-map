#!/usr/bin/env python3
"""
検索エンジン(SEO)とAI(AEO)向けのページを作る。enrich.py の後に実行する。

作るもの(すべて site/ の中):
  t/<寺ID>.html        寺ごとのページ(構造化データ schema.org BuddhistTemple 入り)
  p/index.html         都道府県の一覧
  p/<都道府県>.html     都道府県ごとの寺院一覧
  experiences.html     坐禅会・写経・宿坊・縁日など体験・行事のある寺の一覧
  sitemap.xml          検索エンジン用のページ一覧
  robots.txt           検索エンジンへの案内
  llms.txt             AI向けのサイト案内
  index.html           __SITE_URL__ などの置き換え

環境変数:
  SITE_URL  公開URL(例 https://kenaoyltd.github.io/temple-map/)。
            空なら GITHUB_REPOSITORY から自動で決める。
"""
import datetime as dt
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exp_util import SCHEMA_DAY, describe, next_dates  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DATA = SITE / "data"

PREFS = ("北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 "
         "山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 "
         "徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県").split()
YSRC_RELIABLE = {1, 3, 4}
FAQ_Q = {"zazen": "で坐禅会はありますか?", "shakyo": "で写経はできますか?", "shukubo": "に泊まれますか(宿坊)?",
         "shojin": "で精進料理は食べられますか?", "ennichi": "の縁日はいつですか?", "festival": "ではどんな行事がありますか?",
         "taiken": "ではどんな体験ができますか?"}  # Wikidata / 主要寺院リスト / Wikipedia情報欄(本文からの推定は除く)


def site_url():
    u = os.environ.get("SITE_URL", "").strip()
    if not u:
        repo = os.environ.get("GITHUB_REPOSITORY", "kenaoyltd/temple-map")
        owner, name = repo.split("/", 1)
        u = f"https://{owner.lower()}.github.io/{name}/"
    return u if u.endswith("/") else u + "/"


BASE = site_url()
TODAY = dt.date.today()
e = html.escape


def jsonld(obj):
    s = json.dumps(obj, ensure_ascii=False, indent=1)
    return '<script type="application/ld+json">\n' + s.replace("</", "<\\/") + "\n</script>"


def pref_of(addr, region):
    addr = re.sub(r"^(〒?\s*\d{3}-?\d{4}\s*|日本[、,\s]*)", "", addr or "")
    for p in PREFS:
        if addr.startswith(p):
            return p
    return region if region in PREFS else ""


def city_of(addr, pref):
    rest = addr[len(pref):] if pref and addr.startswith(pref) else addr
    m = re.match(r"(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])", rest)
    return m.group(1) if m else ""


PAGE_CSS = """
:root{--ink:#2b2620;--ink-2:#6d6355;--line:#e3d9c6;--bg:#f6f1e7;--card:#fffdf8;--accent:#8c2f1b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif}
header.top{background:var(--card);border-bottom:1px solid var(--line)}header.top div{max-width:860px;margin:auto;padding:10px 16px;display:flex;gap:10px;align-items:center}
.seal{width:32px;height:32px;border-radius:6px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700}
header.top a{color:var(--ink);text-decoration:none;font-weight:700}
main{max-width:860px;margin:auto;padding:16px}
nav.crumb{font-size:13px;color:var(--ink-2)}nav.crumb a{color:var(--ink-2)}
h1{font-size:28px;margin:.2em 0}h2{font-size:19px;border-left:4px solid var(--accent);padding-left:8px;margin-top:1.8em}
.lead{color:var(--ink-2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:10px 0}
dl.facts{display:grid;grid-template-columns:7em 1fr;gap:4px 12px;margin:0}dl.facts dt{color:var(--ink-2)}dl.facts dd{margin:0}
.btn{display:inline-block;background:var(--accent);color:#fff;border-radius:8px;padding:8px 14px;text-decoration:none;margin:4px 6px 4px 0}
.btn.sub{background:var(--card);color:var(--ink);border:1px solid var(--line)}
ul.list{padding-left:1.2em}ul.list li{margin:2px 0}
.tag{display:inline-block;font-size:12px;background:#f3e7c0;color:#6b5310;border-radius:10px;padding:1px 8px;margin-right:4px}
.small{font-size:13px;color:var(--ink-2)}footer{max-width:860px;margin:30px auto;padding:16px;font-size:12px;color:var(--ink-2);border-top:1px solid var(--line)}
"""


def page(title, desc, path, body, ld=None, crumbs=None):
    url = BASE + path
    crumb_html = ""
    if crumbs:
        crumb_html = '<nav class="crumb">' + " › ".join(
            f'<a href="{e(BASE + p)}">{e(n)}</a>' if p is not None else e(n) for n, p in crumbs) + "</nav>"
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:site_name" content="日本の寺院マップ">
<meta property="og:locale" content="ja_JP">
<style>{PAGE_CSS}</style>
{jsonld(ld) if ld else ""}
</head>
<body>
<header class="top"><div><span class="seal">寺</span><a href="{e(BASE)}">日本の寺院マップ</a></div></header>
<main>
{crumb_html}
{body}
</main>
<footer>地図:国土地理院 / 寺院データ:© OpenStreetMap contributors (ODbL)、Wikidata (CC0)、Wikipedia (CC BY-SA)。体験・行事は各寺・観光協会などの公開情報をもとに手入力しています。日時や料金は変わることがあるため、お出かけ前に各寺へご確認ください。<br>
<a href="{e(BASE)}p/">都道府県別の寺院一覧</a> ・ <a href="{e(BASE)}experiences.html">坐禅会・宿坊・縁日のあるお寺</a></footer>
</body>
</html>
"""


def load():
    data = json.loads((DATA / "temples.json").read_text(encoding="utf-8"))
    exp = json.loads((DATA / "experiences.json").read_text(encoding="utf-8"))
    sects = json.loads((DATA / "sects.json").read_text(encoding="utf-8"))
    F = {f: i for i, f in enumerate(data["fields"])}
    if "id" not in F:
        sys.exit("先に scripts/enrich.py を実行してください")
    return data, exp, sects, F


def build():
    data, exp, sects, F = load()
    region = data.get("region", "")
    SECTS = sects["sects"]
    TIERS = {t["tier"]: t["name"] for t in sects["tiers"]}
    TYPES = exp["types"]
    exp_by_id = {it["id"]: it for it in exp["items"]}
    v = lambda r, k: r[F[k]] if k in F and F[k] < len(r) else ""  # noqa: E731

    for d in ("t", "p"):
        shutil.rmtree(SITE / d, ignore_errors=True)
        (SITE / d).mkdir(parents=True)

    temples = []
    for r in data["rows"]:
        name = v(r, "name")
        if not name or v(r, "kind") != 0:
            continue
        exps = [exp_by_id[x] for x in (v(r, "exp") or []) if x in exp_by_id]
        rich = v(r, "wp") or v(r, "tier") <= 3 or v(r, "flags") or exps or v(r, "honzon")
        addr = v(r, "addr") or ""
        pref = v(r, "pref") or pref_of(addr, region)
        temples.append({"r": r, "name": name, "exps": exps, "page": bool(rich), "pref": pref, "city": city_of(addr, pref)})

    urls = [(BASE, TODAY), (BASE + "p/", TODAY), (BASE + "experiences.html", TODAY)]

    # ---------------- 寺ごとのページ
    for t in temples:
        if not t["page"]:
            continue
        r, name, pref = t["r"], t["name"], t["pref"]
        tid = v(r, "id")
        path = f"t/{quote(tid)}.html"
        url = BASE + path
        s = SECTS[v(r, "sect")]
        sect_name = v(r, "branch") or (s["name"] if s["key"] != "unknown" else "")
        tier = v(r, "tier")
        rank = v(r, "rank") or (TIERS.get(tier, "") if tier <= 3 else "")
        year = v(r, "year") if v(r, "ysrc") in YSRC_RELIABLE else 0
        year_any = v(r, "year")
        sango = v(r, "sango")
        honzon, founder, addr = v(r, "honzon"), v(r, "founder"), v(r, "addr")
        tel, web, wp, wd, osm = v(r, "tel"), v(r, "web"), v(r, "wp"), v(r, "wd"), v(r, "osm")
        lat, lon = v(r, "lat"), v(r, "lon")
        place = (pref + (t["city"] or "")) or "日本"

        bits = [f"{name}は{place}にある"]
        bits.append(f"{sect_name}の{rank or '寺院'}" if sect_name else (rank or "仏教寺院"))
        desc = "".join(bits) + "です。"
        if year_any:
            desc += f"創建は{year_any}年" + ("頃(推定)" if v(r, "ysrc") == 2 else "") + "。"
        if honzon:
            desc += f"本尊は{honzon}。"
        if t["exps"]:
            desc += "、".join(dict.fromkeys(f"{it['title']}" for it in t["exps"])) + "があります。"

        facts = [("所在地", addr), ("山号", sango), ("宗派", sect_name), ("寺格", rank), ("本尊", honzon),
                 ("創建", (f"{year_any}年" + ("頃(推定)" if v(r, "ysrc") == 2 else "")) if year_any else ""),
                 ("開山・開基", founder), ("札所", v(r, "fuda")), ("文化財", v(r, "bunka")), ("電話", tel)]
        facts_html = "".join(f"<dt>{e(k)}</dt><dd>{e(str(x))}</dd>" for k, x in facts if x)
        if web:
            facts_html += f'<dt>公式サイト</dt><dd><a href="{e(web)}" rel="noopener">{e(re.sub(r"^https?://", "", web)[:50])}</a></dd>'

        exp_html, events, amen, faq = "", [], [], []
        if t["exps"]:
            items = []
            for it in t["exps"]:
                when = describe(it.get("schedule"))
                nxt = next_dates(it.get("schedule"), TODAY, days=400, limit=3)
                line = f'<div class="card"><span class="tag">{e(TYPES.get(it["type"], it["type"]))}</span><b>{e(it["title"])}</b>'
                info = [("日程", when), ("時間", it.get("time", "")), ("料金", it.get("fee", "")), ("予約", it.get("reservation", ""))]
                line += '<dl class="facts">' + "".join(f"<dt>{k}</dt><dd>{e(x)}</dd>" for k, x in info if x)
                if nxt:
                    line += "<dt>次の開催</dt><dd>" + "、".join(f"{d.month}月{d.day}日" for d in nxt) + "(予定)</dd>"
                line += "</dl>"
                if it.get("note"):
                    line += f"<p>{e(it['note'])}</p>"
                src = " ".join(f'<a href="{e(u)}" rel="noopener nofollow">出典{i + 1}</a>' for i, u in enumerate(it.get("sources", [])))
                line += f'<p class="small">{src}(確認日 {e(it.get("checked", ""))})</p></div>'
                items.append(line)
                sch = it.get("schedule") or {}
                if nxt and not sch.get("daily"):
                    ev = {"@type": "Event", "name": f"{name} {it['title']}", "startDate": nxt[0].isoformat(),
                          "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
                          "eventStatus": "https://schema.org/EventScheduled",
                          "location": {"@id": url + "#temple"}, "description": it.get("note") or it["title"]}
                    sc = {"@type": "Schedule", "scheduleTimezone": "Asia/Tokyo"}
                    if sch.get("weekly"):
                        sc.update(repeatFrequency="P1W", byDay=[SCHEMA_DAY[w] for w in sch["weekly"]])
                    elif sch.get("monthly_days"):
                        sc.update(repeatFrequency="P1M", byMonthDay=sch["monthly_days"])
                    elif sch.get("annual"):
                        sc.update(repeatFrequency="P1Y", byMonth=sorted({a["month"] for a in sch["annual"]}),
                                  byMonthDay=sorted({a["day"] for a in sch["annual"]}))
                    if len(sc) > 2:
                        ev["eventSchedule"] = sc
                    if "無料" in it.get("fee", ""):
                        ev["isAccessibleForFree"] = True
                    events.append(ev)
                else:
                    amen.append({"@type": "LocationFeatureSpecification", "name": it["title"], "value": True})
                faq.append((f"{name}" + FAQ_Q.get(it["type"], "ではどんな体験ができますか?"),
                            f"{it['title']}があります。" + (f"日程は{when}。" if when else "") +
                            (f"時間は{it['time']}。" if it.get("time") else "") + "最新情報はお寺にご確認ください。"))
            exp_html = "<h2>体験・行事</h2>" + "".join(items)

        if sect_name:
            faq.insert(0, (f"{name}の宗派は何ですか?", f"{sect_name}です。"))
        if honzon:
            faq.append((f"{name}の本尊は何ですか?", f"{honzon}です。"))
        if addr:
            faq.append((f"{name}はどこにありますか?", f"{addr}にあります。"))

        map_url = f"{BASE}?t={quote(tid)}#16/{lat}/{lon}"
        links = [f'<a class="btn" href="{e(map_url)}">地図で見る</a>',
                 f'<a class="btn sub" href="https://www.google.com/maps/search/?api=1&query={lat},{lon}" rel="noopener">Googleマップで経路を見る</a>']
        if wp:
            links.append(f'<a class="btn sub" href="https://ja.wikipedia.org/wiki/{quote(wp)}" rel="noopener">Wikipedia</a>')
        faq_html = ""
        if faq:
            faq_html = "<h2>よくある質問</h2>" + "".join(f'<div class="card"><b>Q. {e(q)}</b><br>A. {e(a)}</div>' for q, a in faq)

        body = f"""<h1>{e(name)}</h1>
<p class="lead">{e(desc)}</p>
<div>{''.join(links)}</div>
<h2>基本情報</h2>
<div class="card"><dl class="facts">{facts_html}</dl></div>
{exp_html}
{faq_html}
<p class="small">位置・名前は OpenStreetMap、宗派・創建・本尊などは Wikidata / Wikipedia から自動で集めた情報です。誤りを見つけたらお知らせください。</p>"""

        temple_ld = {"@type": "BuddhistTemple", "@id": url + "#temple", "name": name, "url": url,
                     "description": desc,
                     "geo": {"@type": "GeoCoordinates", "latitude": lat, "longitude": lon},
                     "hasMap": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}"}
        if sango:
            temple_ld["alternateName"] = sango + name
        if addr:
            temple_ld["address"] = {"@type": "PostalAddress", "addressCountry": "JP", "streetAddress": addr,
                                    **({"addressRegion": pref} if pref else {})}
        if tel:
            temple_ld["telephone"] = tel
        same = [x for x in [web, f"https://ja.wikipedia.org/wiki/{quote(wp)}" if wp else "",
                            f"https://www.wikidata.org/wiki/{wd}" if wd else "",
                            f"https://www.openstreetmap.org/{osm}" if osm else ""] if x]
        if same:
            temple_ld["sameAs"] = same
        if year:
            temple_ld["foundingDate"] = str(year)
        props = [("宗派", sect_name), ("寺格", rank), ("本尊", honzon), ("山号", sango)]
        temple_ld["additionalProperty"] = [{"@type": "PropertyValue", "name": k, "value": x} for k, x in props if x]
        if events:
            temple_ld["event"] = events
        if amen:
            temple_ld["amenityFeature"] = amen
        crumbs = [("トップ", ""), ("寺院一覧", "p/")]
        if pref:
            crumbs.append((pref, f"p/{quote(pref)}.html"))
        crumbs.append((name, None))
        graph = [temple_ld,
                 {"@type": "WebPage", "@id": url, "url": url, "name": f"{name}({place})", "inLanguage": "ja",
                  "isPartOf": {"@id": BASE + "#website"}, "about": {"@id": url + "#temple"}, "dateModified": data["generated"]},
                 {"@type": "BreadcrumbList", "itemListElement": [
                     {"@type": "ListItem", "position": i + 1, "name": n, **({"item": BASE + p} if p is not None else {})}
                     for i, (n, p) in enumerate(crumbs)]}]
        if faq:
            graph.append({"@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]})
        title = f"{name}({place})" + (f" {sect_name}" if sect_name else "") + "|日本の寺院マップ"
        (SITE / "t" / f"{tid}.html").write_text(
            page(title, desc[:150], path, body, {"@context": "https://schema.org", "@graph": graph}, crumbs), encoding="utf-8")
        t["path"] = path
        urls.append((url, TODAY))

    # ---------------- 都道府県ページ
    by_pref = {}
    for t in temples:
        by_pref.setdefault(t["pref"] or "その他", []).append(t)
    pref_links = []
    for pref in [p for p in PREFS if p in by_pref] + (["その他"] if "その他" in by_pref else []):
        ts = by_pref[pref]
        paged = [t for t in ts if t.get("path")]
        by_city = {}
        for t in sorted(paged, key=lambda t: (t["city"], -len(t["exps"]), t["r"][F["tier"]], t["name"])):
            by_city.setdefault(t["city"] or "(市区町村不明)", []).append(t)
        secs = []
        for city, cts in by_city.items():
            lis = "".join(
                f'<li><a href="{e(BASE + t["path"])}">{e(t["name"])}</a>'
                + "".join(f' <span class="tag">{e(exp["types"].get(x["type"], ""))}</span>' for x in t["exps"]) + "</li>"
                for t in cts)
            secs.append(f"<h2>{e(city)}({len(cts)})</h2><ul class=\"list\">{lis}</ul>")
        path = f"p/{quote(pref)}.html"
        body = (f"<h1>{e(pref)}のお寺一覧</h1><p class=\"lead\">{e(pref)}の寺院 {len(ts):,} 件のうち、宗派・歴史・体験などの情報がある "
                f"{len(paged):,} 件を市区町村ごとに掲載しています。すべての寺は<a href=\"{e(BASE)}\">地図</a>で見られます。</p>" + "".join(secs))
        ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": f"{pref}のお寺一覧", "url": BASE + path,
              "isPartOf": {"@id": BASE + "#website"},
              "mainEntity": {"@type": "ItemList", "numberOfItems": len(paged), "itemListElement": [
                  {"@type": "ListItem", "position": i + 1, "url": BASE + t["path"], "name": t["name"]} for i, t in enumerate(paged[:1000])]}}
        (SITE / "p" / f"{pref}.html").write_text(
            page(f"{pref}のお寺一覧({len(paged):,}件)|日本の寺院マップ", f"{pref}の寺院を宗派・寺格・坐禅会や縁日などの情報とともに一覧で紹介。",
                 path, body, ld, [("トップ", ""), ("寺院一覧", "p/"), (pref, None)]), encoding="utf-8")
        urls.append((BASE + path, TODAY))
        pref_links.append(f'<li><a href="{e(BASE + path)}">{e(pref)}</a>({len(paged):,}件)</li>')
    (SITE / "p" / "index.html").write_text(page(
        "都道府県別のお寺一覧|日本の寺院マップ", "都道府県ごとの寺院一覧。宗派・寺格・創建年・坐禅会や縁日の情報つき。", "p/",
        f"<h1>都道府県別のお寺一覧</h1><ul class=\"list\">{''.join(pref_links)}</ul>",
        {"@context": "https://schema.org", "@type": "CollectionPage", "name": "都道府県別のお寺一覧", "url": BASE + "p/"},
        [("トップ", ""), ("寺院一覧", None)]), encoding="utf-8")

    # ---------------- 体験・行事の一覧
    tmap = {v(t["r"], "id"): t for t in temples}
    groups = {}
    for it in exp["items"]:
        groups.setdefault(it["type"], []).append(it)
    secs, ev_list = [], []
    for typ, label in exp["types"].items():
        its = groups.get(typ)
        if not its:
            continue
        lis = []
        for it in its:
            t = tmap.get(it.get("temple_id", ""))
            nm = f'<a href="{e(BASE + t["path"])}">{e(it["temple"])}</a>' if t and t.get("path") else e(it["temple"])
            lis.append(f"<li>{nm}({e(it['pref'])})— {e(it['title'])}:{e(describe(it.get('schedule')))}</li>")
            ev_list.append(it)
        secs.append(f"<h2>{e(label)}</h2><ul class=\"list\">{''.join(lis)}</ul>")
    (SITE / "experiences.html").write_text(page(
        "坐禅会・写経・宿坊・縁日のあるお寺|日本の寺院マップ",
        "坐禅会、写経、宿坊、精進料理、縁日・大祭など、お寺で体験できること・行事の一覧。日程つき。",
        "experiences.html",
        "<h1>坐禅会・写経・宿坊・縁日のあるお寺</h1><p class=\"lead\">お寺で体験できることと定期的な行事の一覧です。"
        "日時は変わることがあるため、お出かけ前に各寺へご確認ください。情報の追加・修正も受け付けています。</p>" + "".join(secs),
        {"@context": "https://schema.org", "@type": "CollectionPage", "name": "坐禅会・写経・宿坊・縁日のあるお寺",
         "url": BASE + "experiences.html", "isPartOf": {"@id": BASE + "#website"}},
        [("トップ", ""), ("体験・行事", None)]), encoding="utf-8")

    # ---------------- index.html の置き換え
    idx = SITE / "index.html"
    s = idx.read_text(encoding="utf-8")
    s = s.replace("__SITE_URL__", BASE).replace("__GENERATED__", data["generated"]).replace("__REGION__", region)
    idx.write_text(s, encoding="utf-8")

    # ---------------- sitemap / robots / llms.txt
    chunks = [urls[i:i + 45000] for i in range(0, len(urls), 45000)]
    names = []
    for n, ch in enumerate(chunks, 1):
        fn = "sitemap.xml" if len(chunks) == 1 else f"sitemap-{n}.xml"
        names.append(fn)
        (SITE / fn).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                               + "".join(f"<url><loc>{e(u)}</loc><lastmod>{d.isoformat()}</lastmod></url>\n" for u, d in ch)
                               + "</urlset>\n", encoding="utf-8")
    if len(chunks) > 1:
        (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                          + "".join(f"<sitemap><loc>{BASE}{fn}</loc></sitemap>\n" for fn in names)
                                          + "</sitemapindex>\n", encoding="utf-8")
    (SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}sitemap.xml\n", encoding="utf-8")

    st = data["stats"]
    exp_lines = "".join(f"- {it['temple']}({it['pref']}):{it['title']} — {describe(it.get('schedule'))}\n" for it in exp["items"])
    (SITE / "llms.txt").write_text(f"""# 日本の寺院マップ

> {region}の仏教寺院 {st['total']:,} 件を、宗派・寺格・創建年・本尊・文化財、坐禅会・写経・宿坊・縁日などの情報とともに地図と一覧で紹介するサイトです。データ更新日 {data['generated']}。

## 主なページ
- [地図(トップ)]({BASE}): 宗派・寺格・創建年・体験の種類で絞り込める地図
- [都道府県別のお寺一覧]({BASE}p/): 寺ごとのページへのリンク集
- [坐禅会・写経・宿坊・縁日のあるお寺]({BASE}experiences.html): 体験・行事と日程

## 機械で読めるデータ
- [寺院データ(JSON)]({BASE}data/temples.json): fields に列名、rows に1寺1行。id 列が寺ID、寺ページは {BASE}t/<id>.html
- [体験・行事データ(JSON)]({BASE}data/experiences.json): 種類・日程(schedule)・出典・確認日・寺ID(temple_id)
- 各寺のページには schema.org(BuddhistTemple / Event / FAQPage)の構造化データがあります

## 体験・行事(抜粋)
{exp_lines}
## 注意
- 宗派・創建年などは OpenStreetMap / Wikidata / Wikipedia から自動で集めたもので、誤りを含むことがあります
- 体験・行事の日時は変わることがあります。各寺の公式情報で確認するよう案内してください
- ライセンス: OpenStreetMap (ODbL)、Wikidata (CC0)、Wikipedia (CC BY-SA)
""", encoding="utf-8")

    n_pages = sum(1 for t in temples if t.get("path"))
    print(f"SEO: 寺ページ {n_pages:,} / 都道府県ページ {len(pref_links)} / サイトマップ {len(urls):,} URL / 公開URL {BASE}", flush=True)


if __name__ == "__main__":
    build()
