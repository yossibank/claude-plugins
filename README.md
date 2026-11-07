# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。

<img src="docs/images/tech.svg" alt="Claude Code">

## ✨ 機能

| プラグイン | できること |
| --- | --- |
| [pr-browser](plugins/pr-browser) | `gh pr create` で作った PR のページを、[terminal-browser](https://github.com/zenbu-labs/terminal-browser) で右に開く。会話が 128 列より狭い時は下に開く |
| [snapshot-gallery](plugins/snapshot-gallery) | `make snapshot` で描いた PNG を、直す前と後で左右に並べて pane に出す。`/snapshots <セット>` で開き、`j` と `k` で前と次に移る |
| [session-dash](plugins/session-dash) | モデル・版・費用、リポジトリ・ブランチ・差分、利用の上限、今の作業を 2 行、文脈の埋まり具合を右の pane に出す。文脈は種類ごとに色分けした棒と S〜D の評価で出す。pane を閉じている間は入力欄の上に、文脈の 1 行と、モデル・ブランチ・差分・上限の 1 行を出し、作業中は今の作業の 2 行も足す。キャッシュが切れるまでの時間も出す |
| [test-progress](plugins/test-progress) | テストのコマンドの間、進みの棒と落ちたテストを入力欄の上に出し、終わったらトーストで知らせる。コマンドの出力を `.build/test.log` に残しておく |

## 🚀 入れ方

1. マーケットプレイスを足す。

   ```sh
   /plugin marketplace add yossibank/claude-plugins
   ```

2. プラグインを入れて、読み込む。

   ```sh
   /plugin install <プラグイン>@yossibank
   /reload-plugins
   ```

   context-gauge を入れていた時は、`/plugin uninstall context-gauge@yossibank` で外してから session-dash を入れる。

3. pr-browser を使う時は、terminal-browser を入れる。

   ```sh
   brew install terminal-browser
   ```

## 📚 文書

| 知りたいこと | 文書 |
| --- | --- |
| 全リポジトリ共通の決まり | [claude-config](https://github.com/yossibank/claude-config) |

## 🔧 設定

| snapshot-gallery | 既定 | 中身 |
| --- | --- | --- |
| `commandPattern` | `make snapshot SNAPSHOT=<セット>` に当たる正規表現 | 見張るコマンド。1 つ目の組がセットの名前 |
| `snapshotsDir` | `.build/snapshots` | 描いた画像のフォルダ |
| `beforeDir` | `.build/snapshots-before` | 描く前の画像を取っておくフォルダ |

| session-dash | 既定 | 中身 |
| --- | --- | --- |
| `cacheMinutes` | `60` | プロンプトキャッシュの寿命の分数。`5` か `60` |
| `handoffPath` | `.claude/handoff.md` | 引き継ぎメモの置き場 |

| test-progress | 既定 | 中身 |
| --- | --- | --- |
| `commandPattern` | `make test` に当たる正規表現 | 見張るコマンド。区切り（`&&`・`;`・`\|`）ごとに当て、当たった文字を帯とトーストに出す |
| `logPath` | `.build/test.log` | コマンドが `tee` で書き込むログの置き場 |
| `passedLine` | `✔` で始まる行 | 通ったテストの行の正規表現 |
| `failedLine` | `✖` で始まる行 | 落ちたテストの行の正規表現。1 つ目の組が名前 |
| `finishedLine` | `Test Succeeded` などの行 | 終わった行の正規表現 |
| `succeededLine` | `Test Succeeded` か `TEST SUCCEEDED` | 終わった後に成功とみなす行の正規表現 |

## 🛠️ 足し方

1. `plugins/<名前>/` にプラグインを置く。
2. `.claude-plugin/marketplace.json` の `plugins` に足す。
3. `make verify` と `make test` で確かめる。

## 📏 版の上げ方

| 変えたもの | `plugin.json` の `version` で上げる所 | 例 |
| --- | --- | --- |
| 設定の名前を消す・替える、前の動きが残らない変更 | 2 つ目 | `0.1.0` → `0.2.0` |
| 機能を足す、不具合を直す | 3 つ目 | `0.1.0` → `0.1.1` |
| 文書・テストだけ | 上げない | |
