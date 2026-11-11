# ios-build-progress

ビルドのコマンドの間、進みの棒と警告とエラーを入力欄の上に出すプラグイン。

## ✨ 機能

| できること | 中身 |
| --- | --- |
| 進みの棒 | 前の回の手順の数が分かる時は棒・割合・残りの時間を、分からない時は手順の数だけを出す |
| 前の回と比べる | 前の回にかかった時間を出す。それを超えたら、どれだけ長いかを出す |
| 今のターゲットと段 | 今のターゲット、今の段（コンパイル・リンク・署名など）、最後にコンパイルしたファイルの名前を出す |
| 警告 | 警告の数を出す。同じ行は 1 回だけ数える |
| エラー | 3 件まで、ファイルと行を添えて出し、残りは「ほか N 件」にまとめる |
| 動きなし | ログが 30 秒変わらない時は、止まっている時間を出す |
| 終わりの知らせ | 終わったら、成功か失敗かを、警告とエラーの数、かかった時間、前の回の時間と一緒にトーストで知らせる |
| XcodeBuildMCP | 名前が `mcp__XcodeBuildMCP__build` で始まるツールの間は、名前と経った時間を出す。終わったら、結果の文から警告とエラーを数えて知らせる |
| 重なった見張り | コマンドが重なっても、1 本ずつ別の行に出す |
| 止める | ログが書かれ始めた後に 5 分変わらない時と、1 時間たった時は、表示を消す |
| ログが無い時 | 帯は、走り始めた後にログが書かれてから出す。ログが書かれないまま終わった時は、ログを書かないコマンドとみなし、何も知らせない |
| 失敗を知らせる | ログを読むのに失敗した時は、トーストで知らせて見張りを止める |

```
🔨 xcodebuild  ▕████████░░░░▏ 120 / 310 · 38%
   ⚙ MyApp · コンパイル  ⚠ 3  ✖ 1   ⏱ 0:42 · 残り約 1:08 · 前回 1:50
   ▸ SummaryModel.swift
   ✖ SummaryView.swift:42 cannot find 'total' in scope
```

## 📦 入れ方

```sh
/plugin install ios-build-progress --marketplace yossibank/claude-plugins
```

## 🚀 使い方

ビルドのコマンドは、出力を `logPath` のファイルに書き込む。

```sh
xcodebuild -scheme MyApp -destination 'generic/platform=iOS Simulator' build 2>&1 | tee .build/build.log
```

`make build` も同じように見張る。xcbeautify を通す時は、`tee` を前に置くと、手順とエラーをそのままの形で数えられる。

```sh
xcodebuild -scheme MyApp build 2>&1 | tee .build/build.log | xcbeautify
```

見張るコマンドと、見張らないコマンドは次のとおり。

| コマンド | 見張るか |
| --- | --- |
| `xcodebuild … build`、`xcodebuild archive`、動作を書かない `xcodebuild` | 見張る |
| `make build` | 見張る |
| `test` を含むもの（`xcodebuild test`、`make test`） | 見張らない。[ios-test-progress](../ios-test-progress/README.md) の役目 |
| `xcodebuild -list`、`-showBuildSettings` など、ビルドをしないもの | 見張らない |

ログの置き場の基点は、コマンドを動かすフォルダである。次の時は、そこから基点を動かす。

| コマンド | 基点 |
| --- | --- |
| `cd <フォルダ> && xcodebuild …` | `cd` の先 |
| `make -C <フォルダ> build` | `-C` の先 |
| `run-check.sh <ワークツリー> … make build` | 最初の引数のワークツリー |

`$` で始まる変数のパスは読めないので、基点を動かさない。

前の回の手順の数とかかった時間は、成功した回だけ覚える。`xcodebuild` は `-scheme` ごとに分けて覚える。変えたファイルだけをビルドした回は手順が少ないので、次の回の棒と残りの時間は目安である。

[ルートの README の入れ方](../../README.md#-入れ方)

## 🔧 設定

| 名前 | 中身 |
| --- | --- |
| `commandPattern` | 見張るコマンドの正規表現。区切り（`&&`・`;`・`\|`）ごとに当て、当たった文字を帯とトーストに出す |
| `logPath` | コマンドが `tee` で書き込むログの置き場。絶対パスも使える |
| `targetLine` | ターゲットの行の正規表現。空でない最初の組が名前 |
| `stepLine` | 手順の行の正規表現。一致した行を 1 手順と数える |
| `warningLine` | 警告の行の正規表現。同じ行は 1 回だけ数える |
| `errorLine` | エラーの行の正規表現。`パス:行:列: error: 文` の形なら、ファイルと行を添えて出す |
| `finishedLine` | 終わった行の正規表現 |
| `succeededLine` | 終わった後に成功とみなす行の正規表現 |

正規表現が壊れている時は、初めの値で見張り、最初の Bash でトーストで知らせる。

終わった行が無いままコマンドが終わった時は、エラーの行が無ければ成功とみなす。

[既定の値](.claude-plugin/plugin.json)
