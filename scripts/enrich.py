#!/usr/bin/env python3
"""
pipeline.py が作った site/data/temples.json に、
  - 寺ごとの固定ID(id)
  - 坐禅会・宿坊・縁日などの体験・行事(exp)と絞り込み用の印(flags)
を付け足す。体験・行事の元データは data/experiences.json(手入力)。

使い方: python scripts/enrich.py
"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exp_util import TYPE_FLAG  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
RADIUS_M = 3000


def norm_name(n):
    n = re.sub(r"[\s・()（）「」『』]", "", n or "")
    return n.replace("佛", "仏").replace("峯", "峰").replace("龍", "竜").replace("國", "国").replace("圓", "円").replace("總", "総")


def dist_m(a_lat, a_lon, b_lat, b_lon):
    k = math.pi / 180
    x = (b_lon - a_lon) * k * math.cos((a_lat + b_lat) / 2 * k)
    y = (b_lat - a_lat) * k
    return 6371000 * math.hypot(x, y)


def temple_id(r, F):
    if r[F["wd"]]:
        return r[F["wd"]]
    if r[F["osm"]]:
        return "osm-" + r[F["osm"]].replace("/", "-")
    return f"pt-{r[F['lat']]:.5f}-{r[F['lon']]:.5f}".replace(".", "_")


def main():
    path = DATA / "temples.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exp = json.loads((ROOT / "data" / "experiences.json").read_text(encoding="utf-8"))
    fields = data["fields"]
    for f in ("id", "exp"):
        if f not in fields:
            fields.append(f)
    F = {f: i for i, f in enumerate(fields)}
    rows = data["rows"]
    for r in rows:
        while len(r) < len(fields):
            r.append("")

    # ID(重複したら番号を付ける)
    seen = {}
    for r in rows:
        i = temple_id(r, F)
        if i in seen:
            seen[i] += 1
            i = f"{i}-{seen[i]}"
        else:
            seen[i] = 1
        r[F["id"]] = i
        r[F["exp"]] = []

    # 体験・行事を寺に結び付ける(名前・別名が一致し、3km以内で最も近い寺)
    by_name = {}
    for r in rows:
        if r[F["name"]]:
            by_name.setdefault(norm_name(r[F["name"]]), []).append(r)
    matched, missing = 0, []
    for it in exp["items"]:
        names = {norm_name(n) for n in [it["temple"], *it.get("aliases", [])]}
        cands = [r for n in names for r in by_name.get(n, [])]
        cands = [(dist_m(it["lat"], it["lon"], r[F["lat"]], r[F["lon"]]), r) for r in cands]
        cands = [c for c in cands if c[0] <= RADIUS_M]
        if not cands:
            it["temple_id"] = ""
            missing.append(f"{it['temple']}({it['pref']})")
            continue
        r = min(cands, key=lambda c: c[0])[1]
        it["temple_id"] = r[F["id"]]
        r[F["exp"]].append(it["id"])
        flag = TYPE_FLAG.get(it["type"])
        fl = r[F["flags"]] or ""
        if flag and f"|{flag}|" not in fl:
            r[F["flags"]] = (fl or "|") + flag + "|"
        matched += 1

    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA / "experiences.json").write_text(json.dumps(exp, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"体験・行事: {len(exp['items'])} 件中 {matched} 件を寺に結び付けました", flush=True)
    if missing:
        print("  対象地域外または見つからない寺: " + "、".join(sorted(set(missing))), flush=True)


if __name__ == "__main__":
    main()
