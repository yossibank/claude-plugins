# session-dashboard

セッションの状態を、右の pane と入力欄の上に出す Claude Code のプラグイン。

## ✨ 出すもの

| 表 | 中身 |
| --- | --- |
| Claude | モデル、費用、版 |
| リポジトリ | ブランチ、差分（`+追加 -削除 ?未追跡`） |
| Limit | 利用の上限ごとの割合と、戻るまでの時間 |
| Context | 文脈の埋まり具合、種類ごとの量、S〜D の評価、キャッシュが切れるまでの時間 |
| Session | 経った時間、ターン、呼び出しの数、1 時間あたりの費用 |

| 場所 | 中身 |
| --- | --- |
| 右の pane | 上の表をすべて出す |
| 入力欄の上 | pane を閉じている間は、`│` で区切った 1 行 |

今の作業とサブエージェントは [agent-progress](../agent-progress/README.md) に移った。

## 📦 入れ方

```sh
/plugin install session-dashboard --marketplace yossibank/claude-plugins
```

## 🚀 コマンド

| コマンド | 中身 |
| --- | --- |
| `/session-dashboard` | 右の pane を開く |

## 🔧 設定

| 設定 | 既定 | 中身 |
| --- | --- | --- |
| `cacheMinutes` | `60` | プロンプトキャッシュの寿命の分数。`5` か `60` |
