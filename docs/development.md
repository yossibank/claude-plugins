# プラグインの作り方

> [!NOTE]
> プラグインを足す時に置くファイルと手順、バージョンの上げ方が分かる。
> 入れ方は [README.md](../README.md)、作業の決まりは [CLAUDE.md](../CLAUDE.md) にある。

## 📂 置くファイル

| ファイル | 中身 |
| --- | --- |
| `.claude-plugin/plugin.json` | `version` は `0.1.0`。`author` は `{ "name": "yossibank" }`。`types` で `types/index.d.ts` を指す |
| `tsconfig.json` | ほかのプラグインと同じ `extends` の 1 行 |
| `hooks/` | `register.ts` か `register.tsx` がフックの入口 |
| `types/index.d.ts` | 状態の型 |
| `tests/` | テスト |
| `README.md` | プラグインの説明。`/plugin install <名前> --marketplace yossibank/claude-plugins` の入れ方を書く |

```json
{ "extends": "./.claude-plugin/types/tsconfig.json" }
```

## 🚀 足し方

1. 下の「名前の付け方」で名前を決め、上のファイルを `plugins/<名前>/` に置く。
2. `claude --plugin-dir plugins/<名前>` で読み込む。`.claude-plugin/types/` ができる。git には入れない。
3. `.claude-plugin/marketplace.json` の `plugins` に足す。`description` は `plugin.json` と同じにする。
4. ルートの [README.md](../README.md) の機能の表に行を足す。
5. `make verify` と `make test` で確かめる。`tsc` があれば `make types` も通す。

## 🏷️ 名前の付け方

名前は `<領域>-<何を>-<どう見せるか>` の形の kebab-case にする。一覧は名前の順に並ぶので、前の語で同じ領域のものが固まる。

前の語は、次の表から選ぶ。

| 前の語 | 領域 | 例 |
| --- | --- | --- |
| `agent-` | Claude とサブエージェントの動き | `agent-progress` |
| `git-` | git と GitHub | `git-pr-browser` |
| `ios-` | iOS のアプリのビルド・テスト・画面 | `ios-test-progress`、`ios-snapshot-gallery` |
| `session-` | 会話の状態と区切り | `session-dashboard`、`session-handoff` |

後ろの語は、次の表から選ぶ。

| 後ろの語 | 使う時 | 例 |
| --- | --- | --- |
| `-progress` | 動いている間の進みを出し、終わったら止まるか消える | `ios-test-progress`、`ios-build-progress`、`agent-progress` |
| `-dashboard` | 数字をずっと出しておく | `session-dashboard`、`ios-simulator-dashboard` |
| `-gallery` | 画像を並べる | `ios-snapshot-gallery` |
| `-browser` | ページを開く | `git-pr-browser` |

前の語が何をするかまで表している時は、`agent-progress` のように真ん中の語を省く。動作そのものが役目のものは、`session-handoff` のように後ろを動詞 1 語にしてもよい。表に無い領域や見せ方の時は、表に語を足してから名前を付ける。

コマンドの名前は、プラグインの名前と揃えなくてよい。打ちやすい短い語にする（`/handoff`、`/snapshots`）。

## 📏 バージョンの上げ方

| 変えたもの | `plugin.json` の `version` で上げる所 | 例 |
| --- | --- | --- |
| 設定の名前を消す・替える、前の動きが残らない変更 | 2 つ目 | `0.1.0` → `0.2.0` |
| 機能を足す、不具合を直す | 3 つ目 | `0.1.0` → `0.1.1` |
| 文書・テストだけ | 上げない | |

1. `plugin.json` の `version` を上げて、PR をマージする。
2. `/plugin marketplace update yossibank` で、マーケットプレイスを更新する。
3. `/reload-plugins` で、読み込み直す。
