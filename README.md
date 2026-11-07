# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。

<img src="docs/images/tech.svg" alt="Claude Code">

## ✨ 機能

| プラグイン | できること |
| --- | --- |
| [pr-browser](plugins/pr-browser) | `gh pr create` で PR を作ったら、その PR のページを [terminal-browser](https://github.com/zenbu-labs/terminal-browser) で右に開く。会話が 128 列より狭い時は下に開く。terminal-browser を `brew install terminal-browser` で入れておく |
| [snapshot-gallery](plugins/snapshot-gallery) | `make snapshot` で描いた PNG を、直す前と後で左右に並べて pane に出す。`/snapshots <セット>` で開き、`j` と `k` で前と次に移る |
| [context-gauge](plugins/context-gauge) | 文脈の埋まり具合を、種類ごとに色分けした棒で右の pane に出す。pane を閉じている間は入力欄の上に出し、`/clear` の頃合いを知らせる |
| [test-progress](plugins/test-progress) | `make test` の間、進みの棒と落ちたテストを入力欄の上に出す。`make test` の出力を `.build/test.log` に残しておく |

## 🚀 入れ方

```text
# マーケットプレイスを足す
/plugin marketplace add yossibank/claude-plugins
# プラグインを入れて、読み込む
/plugin install <プラグイン>@yossibank
/reload-plugins
```

## 📚 文書

| 知りたいこと | 文書 |
| --- | --- |
| 全リポジトリ共通の決まり | [claude-config](https://github.com/yossibank/claude-config) |

## 🛠️ 足し方

1. `plugins/<名前>/` にプラグインを置く。
2. `.claude-plugin/marketplace.json` の `plugins` に足す。
3. `claude plugin validate .` で検査する。
