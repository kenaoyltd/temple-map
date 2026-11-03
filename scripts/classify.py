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


# ======================================================================
# Wikipedia の情報欄({{日本の寺院 ...}})の読み取り
# ======================================================================
def clean_wiki(v):
    """ウィキ記法を取り除いて読める文字列にする"""
    if not v:
        return ""
    v = re.sub(r"<ref[^>]*/>", "", v)
    v = re.sub(r"<ref[^>]*>.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"<br\s*/?>", "、", v)
    v = re.sub(r"<[^>]+>", "", v)
    v = re.sub(r"\{\{\s*\*\s*\}\}", "、", v)
    for _ in range(3):  # {{lang|ja|xxx}} などは最後の引数を残す。それ以外のテンプレートは消す
        v = re.sub(r"\{\{(?:lang|Lang|nowrap|Nowrap|smaller|small|ruby|Ruby)\|(?:[^{}|]*\|)*([^{}|]*)\}\}", r"\1", v)
        v = re.sub(r"\{\{[^{}]*\}\}", "", v)
    v = re.sub(r"\[\[(?:[^\[\]|]*\|)?([^\[\]]*)\]\]", r"\1", v)
    v = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", v)
    v = re.sub(r"'''?", "", v)
    v = re.sub(r"\s+", " ", v).strip(" 、,・")
    return v


def parse_infobox(wikitext):
    """寺院の情報欄から {項目名: 値} を取り出す。見つからなければ {}"""
    if not wikitext:
        return {}
    m = re.search(r"\{\{\s*(?:日本の寺院|Infobox 日本の寺院|Infobox 寺院|寺院)\s*\n?\|", wikitext)
    if not m:
        return {}
    # 対応する }} までを切り出す(入れ子を数える)
    i, depth, start = m.start(), 0, m.start()
    while i < len(wikitext) - 1:
        two = wikitext[i:i + 2]
        if two == "{{":
            depth += 1; i += 2; continue
        if two == "}}":
            depth -= 1; i += 2
            if depth == 0:
                break
            continue
        i += 1
    body = wikitext[start + 2:i - 2]
    # トップレベルの | で分割
    parts, buf, d, sq = [], "", 0, 0
    j = 0
    while j < len(body):
        c2 = body[j:j + 2]
        if c2 == "{{": d += 1; buf += c2; j += 2; continue
        if c2 == "}}": d -= 1; buf += c2; j += 2; continue
        if c2 == "[[": sq += 1; buf += c2; j += 2; continue
        if c2 == "]]": sq -= 1; buf += c2; j += 2; continue
        if body[j] == "|" and d == 0 and sq == 0:
            parts.append(buf); buf = ""; j += 1; continue
        buf += body[j]; j += 1
    parts.append(buf)
    out = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# ---- 寺格の段階 -------------------------------------------------------
def tier_from_rank(rank):
    """情報欄の「寺格」から 1〜4 の段階を決める"""
    if not rank:
        return 4
    if re.search(r"総本山|総本寺|総本院|宗祖本廟", rank):
        return 1
    if "別格大本山" in rank:
        return 2
    rest = re.sub(r"準別格本山|准別格本山|別格本山|中本山|准本山|準本山", "", rank)
    if re.search(r"大本山|本山|本寺", rest):
        return 2
    if re.search(r"別格|中本山|准本山|準本山|門跡|由緒寺院|勅願寺|官寺|五山|十刹|本坊|別院", rank):
        return 3
    return 4


# ---- 和暦 → 西暦 ------------------------------------------------------
ERAS = """大化645 白雉650 朱鳥686 大宝701 慶雲704 和銅708 霊亀715 養老717 神亀724 天平感宝749 天平勝宝749 天平宝字757
天平神護765 神護景雲767 天平729 宝亀770 天応781 延暦782 大同806 弘仁810 天長824 承和834 嘉祥848 仁寿851 斉衡854 天安857
貞観859 元慶877 仁和885 寛平889 昌泰898 延喜901 延長923 承平931 天慶938 天暦947 天徳957 応和961 康保964 安和968 天禄970
天延973 貞元976 天元978 永観983 寛和985 永延987 永祚989 正暦990 長徳995 長保999 寛弘1004 長和1012 寛仁1017 治安1021
万寿1024 長元1028 長暦1037 長久1040 寛徳1044 永承1046 天喜1053 康平1058 治暦1065 延久1069 承保1074 承暦1077 永保1081
応徳1084 寛治1087 嘉保1094 永長1096 承徳1097 康和1099 長治1104 嘉承1106 天仁1108 天永1110 永久1113 元永1118 保安1120
天治1124 大治1126 天承1131 長承1132 保延1135 永治1141 康治1142 天養1144 久安1145 仁平1151 久寿1154 保元1156 平治1159
永暦1160 応保1161 長寛1163 永万1165 仁安1166 嘉応1169 承安1171 安元1175 治承1177 養和1181 寿永1182 元暦1184 文治1185
建久1190 正治1199 建仁1201 元久1204 建永1206 承元1207 建暦1211 建保1213 承久1219 貞応1222 元仁1224 嘉禄1225 安貞1227
寛喜1229 貞永1232 天福1233 文暦1234 嘉禎1235 暦仁1238 延応1239 仁治1240 寛元1243 宝治1247 建長1249 康元1256 正嘉1257
正元1259 文応1260 弘長1261 文永1264 建治1275 弘安1278 正応1288 永仁1293 正安1299 乾元1302 嘉元1303 徳治1306 延慶1308
応長1311 正和1312 文保1317 元応1319 元亨1321 正中1324 嘉暦1326 元徳1329 元弘1331 建武1334 延元1336 興国1340 正平1346
建徳1370 文中1372 天授1375 弘和1381 元中1384 暦応1338 康永1342 貞和1345 観応1350 文和1352 延文1356 康安1361 貞治1362
応安1368 永和1375 康暦1379 永徳1381 至徳1384 嘉慶1387 康応1389 明徳1390 応永1394 正長1428 永享1429 嘉吉1441 文安1444
宝徳1449 享徳1452 康正1455 長禄1457 寛正1460 文正1466 応仁1467 文明1469 長享1487 延徳1489 明応1492 文亀1501 永正1504
大永1521 享禄1528 天文1532 弘治1555 永禄1558 元亀1570 天正1573 文禄1592 慶長1596 元和1615 寛永1624 正保1644 慶安1648
承応1652 明暦1655 万治1658 寛文1661 延宝1673 天和1681 貞享1684 元禄1688 宝永1704 正徳1711 享保1716 元文1736 寛保1741
延享1744 寛延1748 宝暦1751 明和1764 安永1772 天明1781 寛政1789 享和1801 文化1804 文政1818 天保1830 弘化1844 嘉永1848
安政1854 万延1860 文久1861 元治1864 慶応1865 明治1868 大正1912 昭和1926 平成1989 令和2019"""
ERA_START = {m.group(1): int(m.group(2)) for m in re.finditer(r"(\D+?)(\d{3,4})", ERAS.replace("\n", " ").replace(" ", ""))}
REIGN_START = {"推古": 593, "舒明": 629, "皇極": 642, "孝徳": 645, "斉明": 655, "天智": 668, "天武": 673, "持統": 690,
               "文武": 697, "元明": 707, "元正": 715, "聖武": 724, "孝謙": 749, "淳仁": 758, "称徳": 764, "光仁": 770,
               "桓武": 781, "平城": 806, "嵯峨": 809, "淳和": 823, "仁明": 833, "文徳": 850, "清和": 858}
_ERA_RE = re.compile("(" + "|".join(sorted(ERA_START, key=len, reverse=True)) + r")(元|[0-9０-９]{1,2}|[一二三四五六七八九十]{1,3})年")
_KANSUJI = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _kan2int(s):
    if s == "元":
        return 1
    s = s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if s.isdigit():
        return int(s)
    n, cur = 0, 0
    for ch in s:
        if ch == "十":
            n += (cur or 1) * 10; cur = 0
        else:
            cur = _KANSUJI.get(ch, 0)
    return n + cur


def year_from_field(text):
    """情報欄の「創建年」などから西暦年を推定。(年, 伝承かどうか) を返す"""
    if not text:
        return None, False
    legend = bool(re.search(r"伝|頃|とされ|説|ごろ|推定", text))
    m = re.search(r"([0-9]{3,4})年", text)
    if m and 538 <= int(m.group(1)) <= 2026:
        return int(m.group(1)), legend
    m = _ERA_RE.search(text)
    if m:
        y = ERA_START[m.group(1)] + _kan2int(m.group(2)) - 1
        if 538 <= y <= 2026:
            return y, legend
    for k, y in REIGN_START.items():
        if k + "天皇" in text:
            return y, True
    m = re.search(r"([0-9]{1,2})世紀", text)
    if m:
        return (int(m.group(1)) - 1) * 100 + 50, True
    return None, legend


# ---- 格式タグ ----------------------------------------------------------
def flags_of(fuda, bunka, rank, intro):
    """札所・国宝・重要文化財・県市指定・門跡/勅願 のタグを返す"""
    tags = []
    if fuda or re.search(r"札所|霊場第", intro or ""):
        tags.append("札所")
    b = (bunka or "") + " " + (intro or "")
    if "国宝" in b:
        tags.append("国宝")
    if "重要文化財" in b:
        tags.append("重文")
    if re.search(r"(県|府|都|道|市|町|村)指定", bunka or "") or re.search(r"(県|府|都|道|市|町|村)指定(の)?(重要)?(有形)?文化財", intro or ""):
        tags.append("指定文化財")
    if re.search(r"門跡|勅願", (rank or "") + (intro or "")[:200]):
        tags.append("門跡・勅願")
    return tags


def is_defunct(intro):
    head = (intro or "").split("。")[0]
    return bool(re.search(r"にあった|に存在した|廃寺|かつて", head))
