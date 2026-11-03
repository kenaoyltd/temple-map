#!/usr/bin/env python3
"""
歴史上の人物の「名前・読み仮名・生没年」の一覧を作る(人物検索の候補・あいまい検索用)。

Wikidata から、日本語版 Wikipedia に記事がある人物のうち 1945年までに生まれた人を取得し、
site/data/persons.json に保存する。読み仮名は Wikidata の「仮名表記」(P1814)。
"""
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("RAW_DIR", ROOT / "raw"))
OUT = ROOT / "site" / "data" / "persons.json"
REFRESH = os.environ.get("REFRESH", "1") == "1"
WDQS = "https://query.wikidata.org/sparql"
S = requests.Session()
S.headers["User-Agent"] = f"japan-temple-map/1.0 (https://github.com/{os.environ.get('GITHUB_REPOSITORY', 'local')})"

# 読み仮名(P1814)を持つ人物から絞り込む(日付だけで絞ると重すぎて時間切れになるため)
Q = """SELECT ?item ?label ?kana ?desc ?b ?d ?sl ?art WHERE {{
  ?item wdt:P1814 ?kana ; wdt:P31 wd:Q5 ; wdt:P569 ?b .
  FILTER(?b >= "{s}-01-01T00:00:00Z"^^xsd:dateTime && ?b < "{e}-01-01T00:00:00Z"^^xsd:dateTime)
  ?art schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> .
  ?item wikibase:sitelinks ?sl .
  OPTIONAL {{ ?item rdfs:label ?label FILTER(LANG(?label) = "ja") }}
  OPTIONAL {{ ?item schema:description ?desc FILTER(LANG(?desc) = "ja") }}
  OPTIONAL {{ ?item wdt:P570 ?d }}
}}"""


def log(*a):
    print(*a, flush=True)


def yr(b, k):
    m = re.match(r"^([+-]?)0*(\d{1,4})-", (b.get(k) or {}).get("value", ""))
    return (-1 if m.group(1) == "-" else 1) * int(m.group(2)) if m else None


def yfmt(y):
    return f"{y:04d}" if y >= 0 else f"-{-y:04d}"


def fetch(s, e, depth=0):
    """[s, e) 年生まれを取得。失敗(時間切れ)したら期間を半分に分けて取り直す"""
    for attempt in range(3):
        try:
            r = S.get(WDQS, params={"query": Q.format(s=yfmt(s), e=yfmt(e)), "format": "json"},
                      headers={"Accept": "application/sparql-results+json"}, timeout=90)
            if r.status_code == 200:
                return r.json()["results"]["bindings"]
            if r.status_code == 429:
                time.sleep(int(r.headers.get("Retry-After", 30)))
                continue
            break  # 500 などは時間切れ → 分割
        except Exception:  # noqa: BLE001
            time.sleep(5)
    if e - s <= 1 or depth > 8:
        log(f"  {s}〜{e}年生まれ: 取得できずスキップ")
        return []
    m = (s + e) // 2
    return fetch(s, m, depth + 1) + fetch(m, e, depth + 1)


def main():
    cache = RAW / "persons.json"
    if cache.exists() and not REFRESH:
        log("人物一覧: 既存データを使用")
        OUT.write_text(cache.read_text(encoding="utf-8"), encoding="utf-8")
        return
    ranges = [(-800, 1100), (1100, 1450), (1450, 1600), (1600, 1700), (1700, 1800),
              (1800, 1850), (1850, 1880), (1880, 1900), (1900, 1920), (1920, 1946)]
    people = {}
    t0 = time.time()
    for s, e in ranges:
        if time.time() - t0 > 25 * 60:
            log("人物一覧: 時間がかかりすぎたので、ここまでの分で保存します")
            break
        rows = fetch(s, e)
        for b in rows:
            qid = b["item"]["value"].rsplit("/", 1)[-1]
            title = unquote(b["art"]["value"].rsplit("/wiki/", 1)[-1]).replace("_", " ")
            label = b.get("label", {}).get("value") or title
            by, dy = yr(b, "b"), yr(b, "d")
            p = people.setdefault(qid, {"n": label, "k": "", "b": by, "d": dy, "s": int(b["sl"]["value"]),
                                        "t": title, "x": (b.get("desc", {}).get("value") or "")[:18]})
            if b.get("kana") and not p["k"]:
                p["k"] = b["kana"]["value"]
            if by is not None and (p["b"] is None or by < p["b"]):
                p["b"] = by
        log(f"人物一覧: {s}〜{e}年生まれ {len(rows)} 件(累計 {len(people)} 人)")
        time.sleep(2)
    rows = sorted(people.values(), key=lambda p: -p["s"])
    out = {"fields": ["n", "k", "b", "d", "s", "t", "x"],
           "rows": [[p["n"], p["k"], p["b"], p["d"], p["s"], "" if p["t"] == p["n"] else p["t"], p["x"]] for p in rows]}
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(text, encoding="utf-8")
    if rows:  # 取得に失敗して空のときは、次回また取り直すため保存しない
        RAW.mkdir(exist_ok=True)
        cache.write_text(text, encoding="utf-8")
    log(f"人物一覧: {len(rows)} 人(読み仮名あり {sum(1 for p in rows if p['k'])} 人)/ {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log("人物一覧の作成に失敗しました(地図本体には影響しません):", e)
        sys.exit(0)
