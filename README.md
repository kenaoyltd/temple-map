# 日本の寺院マップ

全国の仏教寺院を地図に表示し、**宗派ごとの色分け**・**寺格(総本山〜一般寺院のピラミッド)**・**創建年と宗派の歴史**を見られるウェブサイトです。
サーバーは不要で、GitHub の無料機能(GitHub Actions と GitHub Pages)だけで動きます。

## できること

- 寺院を宗派ごとに色分けして地図に表示(寺格が高いほど大きな点)
- 宗派・寺格で絞り込み、寺の名前で検索
- 創建年スライダーと ▶ ボタンで、時代とともに寺が増えていく様子を再生
- 寺をクリックすると、宗派・寺格・創建年・開山とWikipediaの説明を表示
- 「宗派の歴史」タブで各宗派の成立年表、「寺格」タブで頂点の寺の一覧

## 公開の手順(初回だけ、20〜30分)

1. **GitHub アカウントを作る**(無料)— https://github.com/signup
2. 右上の「+」→「New repository」。名前は `temple-map` など、**Public** を選んで「Create repository」。
3. 作成直後の画面の「uploading an existing file」を押し、このフォルダの中身を**全部**ドラッグして「Commit changes」。
4. リポジトリに `.github/workflows/build.yml` があるか確認します。
   Mac の Finder では `.github` フォルダが隠れていてアップロードされないことがあります。無い場合は
   「Add file」→「Create new file」でファイル名に `.github/workflows/build.yml` と入力し、
   同じ名前のファイルの中身を貼り付けて保存してください。
5. 「Settings」→ 左の「Pages」→「Source」を **GitHub Actions** にする。
6. 「Actions」タブ →(確認が出たら有効化)→ 左の「寺院マップを作成・公開」→「Run workflow」→ 緑の「Run workflow」。
7. 完了(群馬県なら5〜10分)すると、`https://<あなたのユーザー名>.github.io/temple-map/` で見られます。

## 全国に広げる

`region.txt` の中身を `全国` に書き換えて保存(GitHub の画面で鉛筆マークから編集できます)し、手順6と同じく「Run workflow」を押します。
全国はデータが多いため数時間かかります。1回の実行で終わらないときは、途中まで保存して続きを自動で次の実行に回します(その間サイトは前回の版のまま)。都道府県名(`京都府` など)を書けばその県だけ、地方名(`関東`・`東北`・`中部`・`近畿`・`関西`・`中国`・`四国`・`九州`)を書けばその地方だけ、`東京都,神奈川県` のようにカンマで区切れば複数の県になります。

データは**毎月2日に自動で取り直されます**。サイトの見た目を変えたときは、保存済みのデータで数分で作り直されます。

## データの出どころと精度

| 情報 | 出どころ |
|---|---|
| 寺の位置・名前・宗派 | OpenStreetMap |
| 創建年・開山 | Wikidata、Wikipedia本文からの推定 |
| 寺格・宗派の派 | Wikipedia冒頭文(「〇〇宗〇〇派の大本山」など)から判定 |
| 主要な総本山・大本山 | `data/head_temples.json`(手入力リスト) |

- 位置はほぼ網羅できますが、**宗派・寺格・歴史が分かるのはWikipediaやWikidataに情報がある寺が中心**です。小さな寺は「宗派不明」「一般寺院」と表示されます。
- 創建年の「推定」は文章から機械的に読み取ったもので、誤りを含むことがあります。

## 自分で直す・増やす

- `data/head_temples.json` … 総本山・大本山などを追加・修正(宗派・寺格・創建年が上書きされます)
- `data/sects.json` … 宗派の色、年表の説明文、寺格の説明
- `site/` … サイトの見た目(`index.html`・`style.css`・`app.js`)
- `scripts/` … データ取得と判定のプログラム

## 坐禅会・宿坊・縁日など(体験・行事)

`data/experiences.json` に手入力します。寺の名前と大まかな緯度経度で、地図上の寺に自動で結び付きます(半径3km以内)。
日程は `weekly`(毎週)、`monthly_days`(毎月○日)、`monthly_nth`(第n○曜)、`annual`(毎年)、`daily`(通年)、`text`(言葉だけ)で書けます。
**出典(sources)と確認日(checked)を必ず入れてください。** 日程は変わるので、年1回は公式情報で確かめ直します。

## 検索エンジン・AI向け(SEO / AEO)

公開のたびに `scripts/enrich.py` と `scripts/seo.py` が次のものを自動で作ります。

- 寺ごとのページ `t/<寺ID>.html`(構造化データ schema.org:BuddhistTemple・Event・FAQPage・パンくず)
  - 情報の少ない寺までページにすると「中身の薄いページ」と見なされるため、Wikipedia記事・寺格・本尊・文化財・体験のどれかがある寺だけ作ります
- 都道府県ごとの一覧 `p/`、体験・行事の一覧 `experiences.html`
- `sitemap.xml`・`robots.txt`・AI向けの案内 `llms.txt`
- トップページの構造化データ(WebSite・Dataset)

公開後は [Google Search Console](https://search.google.com/search-console) にサイトを登録し、`sitemap.xml` を送信してください。

## AIエージェントから使う(MCP)

`worker/` フォルダに MCP サーバーがあります。**Cloudflare Workers(無料枠)** で動き、データは GitHub Pages の `data/*.json` を読みます。
パソコンでプログラムを動かし続ける必要はありません。サイトのデータを更新すれば、MCP の答えも自動で新しくなります(最大30分遅れ)。

道具:`search_temples`(名前・都道府県・市区町村・宗派・体験の種類・現在地からの距離で探す)、`get_temple`(1寺の詳細)、
`find_experiences`(坐禅会・写経・宿坊・縁日などの一覧)、`upcoming_events`(期間内の行事を日付順に)

### 初回だけの準備(15分ほど)

1. **Cloudflare のアカウントを作る**(無料)— https://dash.cloudflare.com/sign-up
2. **アカウントID を控える** — Cloudflare の画面で「Workers & Pages」を開くと右側に「Account ID」があります。
3. **鍵(APIトークン)を作る** — 右上の人のアイコン →「My Profile」→「API Tokens」→「Create Token」→
   「Edit Cloudflare Workers」の「Use template」→ そのまま「Continue to summary」→「Create Token」。表示された文字列を控えます(一度しか表示されません)。
4. **GitHub に鍵を登録する** — このリポジトリの「Settings」→「Secrets and variables」→「Actions」→「New repository secret」で2つ登録:
   - 名前 `CLOUDFLARE_API_TOKEN` … 手順3の文字列
   - 名前 `CLOUDFLARE_ACCOUNT_ID` … 手順2のID
5. **公開する** — 「Actions」タブ → 左の「MCPサーバーを公開(Cloudflare Workers)」→「Run workflow」。
   完了すると、ログの最後に `https://temple-map-mcp.<あなたの名前>.workers.dev` のようなURLが出ます。

ブラウザでそのURLを開いて「日本の寺院マップ MCP サーバー」と出れば成功です。

### AIにつなぐ

接続先は **`https://temple-map-mcp.<あなたの名前>.workers.dev/mcp`**(最後に `/mcp` を付けます)。
Claude では、設定のコネクタから「カスタムコネクタを追加」でこのURLを登録します。認証はありません(読み取り専用)。

`worker/wrangler.toml` の `TEMPLE_SITE_URL` は、データを読むサイトのURLです。ユーザー名やリポジトリ名を変えたら直してください。

## ライセンス表記

地図:国土地理院(地理院タイル)/ 寺院データ:© OpenStreetMap contributors(ODbL)、Wikidata(CC0)、Wikipedia(CC BY-SA)
