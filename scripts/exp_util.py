"""体験・行事(data/experiences.json)の共通処理:日程の文章化と、次の開催日の計算。"""
import calendar
import datetime as dt

WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WD_JA = dict(zip(WD, "月火水木金土日"))
TYPE_FLAG = {"zazen": "坐禅", "shakyo": "写経", "shukubo": "宿坊", "shojin": "精進料理",
             "ennichi": "縁日・行事", "festival": "縁日・行事", "taiken": "体験"}
# schema.org の曜日
SCHEMA_DAY = {w: f"https://schema.org/{n}" for w, n in zip(WD, ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])}


def describe(s):
    """schedule を「毎週金・土曜」のような日本語にする。"""
    if not s:
        return ""
    if s.get("daily"):
        return "通年"
    if s.get("weekly"):
        return "毎週" + "・".join(WD_JA[w] for w in s["weekly"]) + "曜"
    if s.get("monthly_days"):
        return "毎月" + "・".join(str(d) for d in s["monthly_days"]) + "日"
    if s.get("monthly_nth"):
        return "毎月" + "・".join(f"第{x['n']}{WD_JA[x['weekday']]}曜" for x in s["monthly_nth"])
    if s.get("annual"):
        parts = []
        for a in s["annual"]:
            d = a.get("days", 1)
            parts.append(f"{a['month']}月{a['day']}日" + (f"〜{a['day'] + d - 1}日" if d > 1 else ""))
        return "毎年" + "・".join(parts)
    return s.get("text", "")


def occurs_on(s, day):
    """その日に開催があるか(daily と text は判定しない → None)。"""
    if not s or s.get("daily") or s.get("text") and len(s) == 1:
        return None
    if s.get("weekly"):
        return WD[day.weekday()] in s["weekly"]
    if s.get("monthly_days"):
        return day.day in s["monthly_days"]
    if s.get("monthly_nth"):
        for x in s["monthly_nth"]:
            if WD[day.weekday()] == x["weekday"] and (day.day - 1) // 7 + 1 == x["n"]:
                return True
        return False
    if s.get("annual"):
        for a in s["annual"]:
            start = dt.date(day.year, a["month"], min(a["day"], calendar.monthrange(day.year, a["month"])[1]))
            if start <= day < start + dt.timedelta(days=a.get("days", 1)):
                return True
        return False
    return None


def next_dates(s, start, days=60, limit=5):
    out = []
    for i in range(days):
        d = start + dt.timedelta(days=i)
        if occurs_on(s, d):
            out.append(d)
            if len(out) >= limit:
                break
    return out
