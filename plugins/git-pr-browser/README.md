# git-pr-browser

`gh pr create` で作った PR のページを terminal-browser で開き、今のブランチの PR の状態を入力欄の上に出すプラグイン。

## ✨ 機能

| できること | 中身 |
| --- | --- |
| PR を開く | `gh pr create` の出力にある最後の PR の URL を開く |
| 向きを選ぶ | 会話の幅が 128 列より狭い時は下に、それ以外は右に開く |
| 幅が分からない時 | 幅は入力欄の上を描いた時に分かる。まだ描かれていない時や端末でない時は、右に開く |
| PR の状態 | 今のブランチに開いている PR があれば、番号・CI の通った数と落ちた数と待ちの数・レビューの状態・未解決のコメントの数・題を、入力欄の上に 1 行で出す。落ちた CI は、名前を 3 件まで次の行に出す |
| 取り直す時 | セッションの始まり、`gh pr create`・`git push`・`git switch`・`gh pr merge` などの後、メインのターンの終わり。CI が待ちの間は、`pollSeconds` 秒ごと |
| 変わり目を知らせる | CI が落ちた・すべて通った、承認された・変更を頼まれた、未解決のコメントが増えた、マージされた・閉じられた時に、トーストで知らせる |
| PR が無い時 | 帯を出さない。マージされた・閉じられた PR も出さない。`gh` が無い時や失敗した時は、何も知らせずに出さない |
| 失敗を知らせる | terminal-browser が無い時や、開けなかった時は、トーストで知らせる |

帯の読み方は次のとおり。

| 行 | 中身 |
| --- | --- |
| `🔀 #31 · CI ✔ 5 ✖ 1 ◌ 2 · レビュー待ち · 未解決 3 · feat: 直す` | PR の番号、CI の通った数・落ちた数・待ちの数、レビューの状態、未解決のスレッドの数、題 |
| `   ✖ lint、test` | 落ちた CI の名前 |

## 📦 入れ方

先に `brew install terminal-browser` で terminal-browser を入れる。PR の状態には [GitHub CLI](https://cli.github.com) の `gh` が要る。

```sh
/plugin install git-pr-browser --marketplace yossibank/claude-plugins
```

## 🚀 使い方

| コマンド | 中身 |
| --- | --- |
| `/pr` | 今のブランチの PR の状態を取り直し、ページを開く |

[ルートの README の入れ方](../../README.md#-入れ方)

## 🔧 設定

| 名前 | 中身 |
| --- | --- |
| `pollSeconds` | CI が終わるまで、PR の状態を取り直す間隔（秒） |

[既定の値](.claude-plugin/plugin.json)
