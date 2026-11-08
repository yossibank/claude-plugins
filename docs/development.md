# プラグインの作り方

> [!NOTE]
> プラグインを足す時に置くファイルと手順、バージョンの上げ方が分かる。
> 入れ方は [README.md](../README.md)、作業の決まりは [CLAUDE.md](../CLAUDE.md) にある。

## 📂 置くファイル

| ファイル | 中身 |
| --- | --- |
| `.claude-plugin/plugin.json` | `version` は `0.1.0`。`types` で `types/index.d.ts` を指す |
| `tsconfig.json` | ほかのプラグインと同じ `extends` の 1 行 |
| `hooks/` | `register.ts` か `register.tsx` がフックの入口 |
| `types/index.d.ts` | 状態の型 |
| `tests/` | テスト |
| `README.md` | プラグインの説明 |

```json
{ "extends": "./.claude-plugin/types/tsconfig.json" }
```

## 🚀 足し方

1. 上のファイルを `plugins/<名前>/` に置く。
2. `claude --plugin-dir plugins/<名前>` で読み込む。`.claude-plugin/types/` ができる。git には入れない。
3. `.claude-plugin/marketplace.json` の `plugins` に足す。`description` は `plugin.json` と同じにする。
4. ルートの [README.md](../README.md) の機能の表に行を足す。
5. `make verify` と `make test` で確かめる。`tsc` があれば `make types` も通す。

## 📏 バージョンの上げ方

| 変えたもの | `plugin.json` の `version` で上げる所 | 例 |
| --- | --- | --- |
| 設定の名前を消す・替える、前の動きが残らない変更 | 2 つ目 | `0.1.0` → `0.2.0` |
| 機能を足す、不具合を直す | 3 つ目 | `0.1.0` → `0.1.1` |
| 文書・テストだけ | 上げない | |

1. `plugin.json` の `version` を上げて、PR をマージする。
2. `/plugin marketplace update yossibank` で、マーケットプレイスを更新する。
3. `/reload-plugins` で、読み込み直す。
