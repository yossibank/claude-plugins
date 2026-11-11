# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。

<img src="docs/images/tech.svg" alt="Claude Code">

## ✨ 機能

| プラグイン | できること |
| --- | --- |
| [agent-progress](plugins/agent-progress/README.md) | メインとサブエージェントが今していることを、動く Claude のアイコン付きのカードで右の pane に出す。作業の一覧の進みも出す |
| [git-pr-browser](plugins/git-pr-browser/README.md) | `gh pr create` で作った PR のページを、[terminal-browser](https://github.com/zenbu-labs/terminal-browser) で右に開く。今のブランチの PR の CI・レビュー・未解決のコメントを入力欄の上に出し、変わり目をトーストで知らせる |
| [ios-build-progress](plugins/ios-build-progress/README.md) | ビルドのコマンド（`xcodebuild`・`make build`）の間、進みの棒・今のターゲットと段・警告とエラーを入力欄の上に出し、終わったらトーストで知らせる。XcodeBuildMCP のビルドのツールも見張る。コマンドの出力を `.build/build.log` に残しておく |
| [ios-simulator-dashboard](plugins/ios-simulator-dashboard/README.md) | 起動中の iOS シミュレータ・アプリの状態と、この会話でシミュレータにした操作の履歴と回数を、右の pane に出す。`/simulator` で開き、`r` で更新、`d` で外観を切り替える |
| [ios-snapshot-gallery](plugins/ios-snapshot-gallery/README.md) | `make snapshot` で描いた PNG を、直す前と後で左右に並べて pane に出す。`/snapshots <セット>` で開き、`j` と `k` で前と次に移る |
| [ios-test-progress](plugins/ios-test-progress/README.md) | テストのコマンドの間、進みの棒と落ちたテストとその理由を入力欄の上に出し、終わったらトーストで知らせる。前の回から直った数と、遅いテストも出す。コマンドの出力を `.build/test.log` に残しておく |
| [session-dashboard](plugins/session-dashboard/README.md) | モデル・バージョン・費用・リポジトリ・利用の上限・文脈の埋まり具合・セッションの経過を右の pane に出す。閉じている間は入力欄の上に出す |
| [session-handoff](plugins/session-handoff/README.md) | 文脈が埋まってきたら、右のペインで引き継ぎを勧める。引き継ぎメモを `.claude/handoff.md` に書き、`/clear` した新しい会話の入力欄に入れる |
| [session-next-steps](plugins/session-next-steps/README.md) | ターンの終わりに、次にすることを 3 つまで入力欄の上にボタンで出す。押すと、その指示が入力欄に入る |

## 🗺️ 全体像

```mermaid
flowchart LR
    market[".claude-plugin/marketplace.json"] --> plugin["plugins/名前"]
    plugin --> manifest[".claude-plugin/plugin.json"]
    plugin --> hooks["hooks/register.tsx"]
    plugin --> types["types/index.d.ts"]
    plugin --> tests["tests/"]
    make["make verify / make test"] --> plugin
```

## 💻 実行環境

| 道具 | バージョン | 使う所 |
| --- | --- | --- |
| Claude Code | 2.1.322 | プラグインの実行、`claude plugin validate`、`claude plugin test` |
| TypeScript | 5.4 以上 | `make types` での型の検査 |
| jq | 最新 | `make verify` の version と description の検査 |
| terminal-browser | 最新 | git-pr-browser |
| GitHub CLI（`gh`） | 最新 | git-pr-browser の PR の状態、session-next-steps の PR の有無 |
| Xcode | — | ios-simulator-dashboard の `xcrun simctl`、ios-build-progress が見張る `xcodebuild` |
| macOS | — | ios-snapshot-gallery の `shasum`・`sips`・`open` |

## 🚀 入れ方

```sh
/plugin marketplace add yossibank/claude-plugins
/plugin install <プラグイン>@yossibank
/reload-plugins
```

| プラグイン | 先に入れるもの |
| --- | --- |
| git-pr-browser | `brew install terminal-browser` |

## 📚 文書

| 文書 | 読む時 | 中身 |
| --- | --- | --- |
| [docs/development.md](docs/development.md) | プラグインを足す・バージョンを上げる時 | 置くファイル、足し方、バージョンの上げ方 |
| [CLAUDE.md](CLAUDE.md) | 作業する時 | 確認のコマンド、コードの書き方 |
| [claude-config](https://github.com/yossibank/claude-config) | 全リポジトリの決まりを知る時 | 共通の決まり |
