#!/usr/bin/env python3
"""
市区町村ごとの人口・高齢化率・死亡者数と、地図上の寺院数を集計して
site/data/muni.json(色分け用の境界つきデータ)を作る。

データ:
  人口・年齢・死亡者数 … 総務省「住民基本台帳に基づく人口、人口動態及び世帯数」(市区町村別, 総計)
  市区町村の境界     … 国土数値情報 行政区域(スマートニュース メディア研究所 japan-topography の軽量版)
寺院数は site/data/temples.json(このサイトの地図データ)から数える。
"""
import io
import json
import os
import re
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "muni.json"
TEMPLES = ROOT / "site" / "data" / "temples.json"
REGION = os.environ.get("REGION", "全国").strip() or "全国"
SOUMU_PAGE = "https://www.soumu.go.jp/main_sosiki/jichi_gyousei/daityo/jinkou_jinkoudoutai-setaisuu.html"
FALLBACK = {  # 2026年1月1日現在のファイル(ページから見つからないときの予備)
    "age": "https://www.soumu.go.jp/main_content/000892953.xlsx",
    "dyn": "https://www.soumu.go.jp/main_content/000892952.xlsx",
}
TOPO = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/"
PREF_CODES = {p: f"{i:02d}" for i, p in enumerate(
    "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 "
    "山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 "
    "徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(), start=1)}

S = requests.Session()
S.headers["User-Agent"] = "japan-temple-map/1.0"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 人口データ
def find_xlsx_urls():
    urls = dict(FALLBACK)
    try:
        html = S.get(SOUMU_PAGE, timeout=60).content.decode("utf-8", "ignore")
        for m in re.finditer(r'<a[^>]+href="([^"]+\.xlsx)"[^>]*>(.*?)</a>', html, re.S):
            href, text = m.group(1), re.sub(r"<[^>]+>|\s", "", m.group(2))
            if "【総計】" not in text or "市区町村別" not in text:
                continue
            full = requests.compat.urljoin(SOUMU_PAGE, href)
            if "年齢階級別人口" in text:
                urls["age"] = full
            elif "人口動態" in text:
                urls["dyn"] = full
    except Exception as e:  # noqa: BLE001
        log("  総務省ページの確認に失敗(予備のURLを使用):", e)
    return urls


def read_rows(url):
    import openpyxl
    b = S.get(url, timeout=120).content
    wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def code6(v):
    c = str(v if v is not None else "").strip()
    if c.endswith(".0"):
        c = c[:-2]
    return c.zfill(6) if c.isdigit() else c


def find_header(rows, must):
    """must の文字列をすべて含む行(見出し行)の番号と、その行を返す"""
    for i, r in enumerate(rows[:15]):
        cells = [str(c or "") for c in r]
        if all(any(m in c for c in cells) for m in must):
            return i, cells
    raise RuntimeError(f"見出し行が見つかりません: {must}")


def load_population(urls):
    data = {}
    # 年齢階級別人口:団体コード, 都道府県名, 市区町村名, 性別, 総数, 0-4歳, ...
    rows = read_rows(urls["age"])
    hi, head = find_header(rows, ["総数", "65歳～69歳"])
    i_total = head.index("総数")
    i65 = head.index("65歳～69歳")
    for r in rows[hi + 1:]:
        code, sex = code6(r[0]), str(r[3] or "").strip()
        if not re.fullmatch(r"\d{6}", code) or sex != "計" or str(r[2] or "-").strip() in ("", "-"):
            continue
        nums = [int(x or 0) if str(x or "0").replace("-", "").isdigit() else 0 for x in r[i_total:]]
        total, old = nums[0], sum(nums[i65 - i_total:])
        data[code[:5]] = {"pref": r[1], "name": str(r[2]).strip(), "pop": total, "old": old}
    # 人口動態:死亡者数
    rows = read_rows(urls["dyn"])
    hi, head = find_header(rows, ["死亡者数"])
    i_death = head.index("死亡者数")
    for r in rows[hi + 1:]:
        code = code6(r[0])
        if re.fullmatch(r"\d{6}", code) and code[:5] in data:
            try:
                data[code[:5]]["deaths"] = int(r[i_death] or 0)
            except (TypeError, ValueError):
                pass
    log(f"人口データ: {len(data)} 市区町村")
    return data


# ---------------------------------------------------------------- 境界
def load_boundaries():
    if REGION == "全国":
        url = TOPO + "s0001/N03-21_210101.json"
    else:
        pc = PREF_CODES.get(REGION)
        if not pc:
            raise RuntimeError(f"都道府県名が不明です: {REGION}")
        url = TOPO + f"s0010/N03-21_{pc}_210101.json"
    log("境界データ:", url)
    gj = S.get(url, timeout=120).json()
    merged = {}
    for f in gj["features"]:
        p = f.get("properties") or {}
        code = p.get("N03_007")
        if not code:
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        m = merged.setdefault(code, {"name": (p.get("N03_003") or "") + (p.get("N03_004") or ""), "polys": []})
        m["polys"].extend(polys)
    return merged


def point_in_poly(x, y, poly):
    inside = False
    for ring_i, ring in enumerate(poly):
        n = len(ring)
        j = n - 1
        hit = False
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
                hit = not hit
            j = i
        if ring_i == 0:
            if not hit:
                return False
            inside = True
        elif hit:  # 穴の中
            return False
    return inside


def bbox(polys):
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)


def main():
    if not TEMPLES.exists():
        log("temples.json がないため、統計データは作りません")
        return
    urls = find_xlsx_urls()
    log("人口データ:", urls)
    pop = load_population(urls)
    areas = load_boundaries()

    t = json.loads(TEMPLES.read_text(encoding="utf-8"))
    F = {f: i for i, f in enumerate(t["fields"])}
    pts = [(r[F["lon"]], r[F["lat"]]) for r in t["rows"] if r[F["kind"]] == 0]  # 名前が「寺・院」などの寺院のみ数える

    # 格子で高速化して点を数える
    cell = 0.1
    grid = {}
    for x, y in pts:
        grid.setdefault((int(x / cell), int(y / cell)), []).append((x, y))
    feats = []
    for code, a in areas.items():
        x0, y0, x1, y1 = bbox(a["polys"])
        cnt = 0
        for gx in range(int(x0 / cell), int(x1 / cell) + 1):
            for gy in range(int(y0 / cell), int(y1 / cell) + 1):
                for x, y in grid.get((gx, gy), []):
                    if x0 <= x <= x1 and y0 <= y <= y1 and any(point_in_poly(x, y, poly) for poly in a["polys"]):
                        cnt += 1
        p = pop.get(code, {})
        props = {"c": code, "n": a["name"] or p.get("name", ""), "t": cnt}
        if p:
            props.update({"pop": p["pop"], "old": p["old"], "d": p.get("deaths", 0)})
        coords = [[[[round(c[0], 4), round(c[1], 4)] for c in ring] for ring in poly] for poly in a["polys"]]
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": "MultiPolygon", "coordinates": coords}})

    out = {"type": "FeatureCollection", "features": feats,
           "meta": {"region": REGION, "pop_source": "総務省 住民基本台帳に基づく人口(市区町村別・総計)",
                    "pop_url": urls["age"], "boundary_source": "国土数値情報 行政区域(2021年, スマートニュース メディア研究所 加工)"}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    matched = sum(1 for f in feats if "pop" in f["properties"])
    log(f"統計データ: {len(feats)} 区域(人口と対応 {matched})/ 寺院 {sum(f['properties']['t'] for f in feats)} 件を集計")
    log(f"出力: {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        # 統計がなくても地図本体は公開できるように、失敗してもビルドは止めない
        log("統計データの作成に失敗しました(地図本体には影響しません):", e)
        sys.exit(0)
