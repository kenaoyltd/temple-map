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

`region.txt` の中身を `群馬県` から `全国` に書き換えて保存(GitHub の画面で鉛筆マークから編集できます)し、手順6と同じく「Run workflow」を押します。
全国は 30分〜1時間半ほどかかります。都道府県名(`京都府` など)を書けばその県だけになります。

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

## ライセンス表記

地図:国土地理院(地理院タイル)/ 寺院データ:© OpenStreetMap contributors(ODbL)、Wikidata(CC0)、Wikipedia(CC BY-SA)
