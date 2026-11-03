"""宗派・寺格・創建年を、OSMタグ / Wikidata / Wikipedia冒頭文から判定する関数群。"""
import re

# ---- 宗派 -------------------------------------------------------------
# 日本語キーワード(上から順に判定。浄土真宗を浄土宗より先に、など順序が重要)
JA_RULES = [
    ("jodoshin", ["浄土真宗", "真宗", "本願寺派", "大谷派"]),
    ("jodo",     ["浄土宗", "西山浄土", "浄土"]),
    ("nichiren", ["日蓮", "法華宗", "本門法華", "顕本法華", "法華"]),
    ("rinzai",   ["臨済"]),
    ("soto",     ["曹洞"]),
    ("obaku",    ["黄檗"]),
    ("shugen",   ["修験"]),
    ("shingon",  ["真言"]),
    ("tendai",   ["天台"]),
    ("ji",       ["時宗"]),
    ("yuzu",     ["融通念仏", "融通念佛"]),
    ("nara",     ["法相", "華厳", "律宗", "聖徳宗", "北法相"]),
    ("zen",      ["禅宗"]),
    ("other",    ["単立", "和宗", "聖観音宗", "鞍馬弘教", "粉河観音宗", "観音宗"]),
]

# OSMの denomination 値(ローマ字)。表記揺れが多いので幅広く受ける
ROMAJI_RULES = [
    ("jodoshin", r"(jou?do_?shin|shinshu|jodo_shinshu|^shin$|hongwanji|honganji|otani)"),
    ("jodo",     r"(jou?do(_shu|_shuu)?$|^jou?do|pure_land|seizan)"),
    ("nichiren", r"(nichiren|hokke|lotus)"),
    ("rinzai",   r"(rinzai|linji)"),
    ("soto",     r"(sou?tou?|caodong)"),
    ("obaku",    r"(ou?baku|huangbo)"),
    ("shugen",   r"(shugen)"),
    ("shingon",  r"(shingon)"),
    ("tendai",   r"(tendai|tiantai)"),
    ("ji",       r"(^ji$|^ji_shu$|jishu|jishuu)"),
    ("yuzu",     r"(yuu?zuu?_?nen?butsu|yuzu)"),
    ("nara",     r"(hossou?|yogacara|kegon|huayan|ritsu|risshu|vinaya)"),
    ("zen",      r"(^zen$|chan)"),
    ("other",    r"(won|nonsectarian|tanritsu)"),
]

def sect_from_ja(text):
    if not text:
        return None
    for key, words in JA_RULES:
        for w in words:
            if w in text:
                return key
    return None

def sect_from_romaji(text):
    if not text:
        return None
    t = text.strip().lower().replace("-", "_").replace(" ", "_")
    for part in re.split(r"[;,]", t):
        part = part.strip()
        for key, pat in ROMAJI_RULES:
            if re.search(pat, part):
                return key
    return None

# 「〇〇宗〇〇派」のような宗派名(派まで)を抜き出す
_K = r"[一-龥々ァ-ヶー]"
_RANKS = r"(?:別格大本山|別格本山|準別格本山|中本山|総本山|大本山|本山|総本寺|門跡寺院|門跡)"
BRANCH_RES = [
    re.compile(r"(" + _K + r"{1,12}?(?:宗|派|教))の?" + _RANKS),
    re.compile(r"(" + _K + r"{1,12}?(?:宗|派|教))(?:の|に属する)(?:仏教寺院|寺院|寺)"),
]

def branch_from_text(text):
    if not text:
        return ""
    head = text[:300]
    for rx in BRANCH_RES:
        m = rx.search(head)
        if m:
            return m.group(1)
    return ""

def sect_from_text(text):
    """Wikipedia冒頭文から宗派を判定。「〜の寺院」直前の宗派名を最優先。"""
    if not text:
        return None, ""
    branch = branch_from_text(text)
    if branch:
        s = sect_from_ja(branch)
        if s:
            return s, branch
    # 次点:冒頭2文の中で最初に出てくる宗派キーワード
    head = "。".join(text.split("。")[:2])
    best = None
    best_pos = 10 ** 9
    for key, words in JA_RULES:
        for w in words:
            p = head.find(w)
            if p >= 0 and p < best_pos:
                best, best_pos = key, p
    return best, ""

# ---- 寺格 -------------------------------------------------------------
RANK_RE = re.compile(r"(?:宗|派|教)の?(別格大本山|別格本山|準別格本山|中本山|総本山|大本山|本山|総本寺|門跡寺院|門跡)")
TIER_OF = {
    "総本山": 1, "総本寺": 1,
    "大本山": 2, "別格大本山": 2, "本山": 2,
    "別格本山": 3, "準別格本山": 3, "中本山": 3, "門跡寺院": 3, "門跡": 3,
}

def rank_from_text(text):
    if not text:
        return 4, ""
    head = "。".join(text.split("。")[:2])
    m = RANK_RE.search(head)
    if m:
        r = m.group(1)
        return TIER_OF.get(r, 4), r
    if "単立" in head[:120]:
        return 4, "単立"
    return 4, ""

# ---- 創建年 -----------------------------------------------------------
YEAR_PATTERNS = [
    re.compile(r"(?:創建|開創|建立|開基|開山)(?:は|され|した|された)?[^。]{0,24}?[（(]?(\d{3,4})年"),
    re.compile(r"[（(]?(\d{3,4})年[）)]?(?:に|、|の)?[^。]{0,30}?(?:創建|開創|建立|開基|開山)"),
]

def year_from_text(text):
    if not text:
        return None
    for pat in YEAR_PATTERNS:
        m = pat.search(text[:600])
        if m:
            y = int(m.group(1))
            if 538 <= y <= 2026:
                return y
    return None

def year_from_wikidata(value):
    """'+0816-01-01T00:00:00Z' のような値から年を取る"""
    if not value:
        return None
    m = re.match(r"^([+-]?)(\d{1,4})-", value)
    if not m:
        return None
    y = int(m.group(2))
    if m.group(1) == "-":
        return None
    return y if 538 <= y <= 2026 else None

# ---- 種別(寺 / お堂など) -------------------------------------------
def kind_of(name):
    if not name:
        return "noname"
    if re.search(r"(寺|院|坊|山|門跡|大師|本山|別院|教会|道場|御坊)", name):
        return "temple"
    if re.search(r"(堂|庵|観音|地蔵|薬師|不動|大日|阿弥陀|祠|閻魔|弁天|毘沙門)", name):
        return "hall"
    return "temple"
