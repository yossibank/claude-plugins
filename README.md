# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。

<img src="docs/images/tech.svg" alt="Claude Code">

## ✨ 機能

| プラグイン | できること |
| --- | --- |
| [pr-browser](plugins/pr-browser) | `gh pr create` で作った PR のページを、[terminal-browser](https://github.com/zenbu-labs/terminal-browser) で右に開く。会話が 128 列より狭い時は下に開く |
| [snapshot-gallery](plugins/snapshot-gallery) | `make snapshot` で描いた PNG を、直す前と後で左右に並べて pane に出す。`/snapshots <セット>` で開き、`j` と `k` で前と次に移る |
| [context-gauge](plugins/context-gauge) | 文脈の埋まり具合を、種類ごとに色分けした棒で右の pane に出す。pane を閉じている間は入力欄の上に出し、`/clear` の頃合いを知らせる |
| [test-progress](plugins/test-progress) | テストのコマンドの間、進みの棒と落ちたテストを入力欄の上に出し、終わったらトーストで知らせる。コマンドの出力を `.build/test.log` に残しておく |

## 🚀 入れ方

```text
# マーケットプレイスを足す
/plugin marketplace add yossibank/claude-plugins
# プラグインを入れて、読み込む
/plugin install <プラグイン>@yossibank
/reload-plugins
# pr-browser が使う terminal-browser を入れる
brew install terminal-browser
```

## 📚 文書

| 知りたいこと | 文書 |
| --- | --- |
| 全リポジトリ共通の決まり | [claude-config](https://github.com/yossibank/claude-config) |

## 🔧 設定

| プラグイン | `userConfig` | 既定 | 中身 |
| --- | --- | --- | --- |
| snapshot-gallery | `commandPattern` | `make snapshot SNAPSHOT=<セット>` に当たる正規表現 | 見張るコマンド。1 つ目の組がセットの名前 |
| snapshot-gallery | `snapshotsDir` | `.build/snapshots` | 描いた画像のフォルダ |
| snapshot-gallery | `beforeDir` | `.build/snapshots-before` | 描く前の画像を取っておくフォルダ |
| context-gauge | `cacheMinutes` | `60` | プロンプトキャッシュの寿命の分数。`5` か `60` |
| context-gauge | `yellowAt` | `50` | キャッシュが切れた時に、頃合いとみなす文脈の割合 |
| context-gauge | `redAt` | `80` | これ以上で頃合いとみなす文脈の割合 |
| context-gauge | `breakPattern` | `gh pr merge\|prune-merged\.sh` | 区切りとみなす Bash のコマンドの正規表現。引数の引用符と heredoc の本文の中は見ない |
| context-gauge | `handoffPath` | `.claude/handoff.md` | 引き継ぎメモの置き場 |
| test-progress | `commandPattern` | `make test` に当たる正規表現 | 見張るコマンド。区切り（`&&`・`;`・`\|`）ごとに当て、当たった文字を帯とトーストに出す |
| test-progress | `logPath` | `.build/test.log` | コマンドが `tee` で書き込むログの置き場 |
| test-progress | `passedLine` | `✔` で始まる行 | 通ったテストの行の正規表現 |
| test-progress | `failedLine` | `✖` で始まる行 | 落ちたテストの行の正規表現。1 つ目の組が名前 |
| test-progress | `finishedLine` | `Test Succeeded` などの行 | 終わった行の正規表現 |
| test-progress | `succeededLine` | `Test Succeeded` か `TEST SUCCEEDED` | 終わった後に成功とみなす行の正規表現 |

## 🛠️ 足し方

1. `plugins/<名前>/` にプラグインを置く。
2. `.claude-plugin/marketplace.json` の `plugins` に足す。
3. `claude plugin validate .` で検査する。

## 📏 版の上げ方

| 変えたもの | `plugin.json` の `version` で上げる所 | 例 |
| --- | --- | --- |
| 設定の名前を消す・替える、前の動きが残らない変更 | 2 つ目 | `0.1.0` → `0.2.0` |
| 機能を足す、不具合を直す | 3 つ目 | `0.1.0` → `0.1.1` |
| 文書・テストだけ | 上げない | |
