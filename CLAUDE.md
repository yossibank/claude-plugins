# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。人向けの入口は [README.md](README.md)。

## 作業の進め方

確かめるコマンドと、バージョンの上げ方は次のとおり。

| 場面 | 決まり |
| --- | --- |
| 変更した | `make verify` と `make test` を通す |
| `make verify` | `claude plugin validate` と version の上げ忘れを見る。description も、marketplace.json と plugin.json で比べる |
| `make types` | `tsc` で型を見る。`tsc` と、Claude Code が作る型が要るので、`make verify` には入れない |
| 型の検査が NG | `plugins/<名前>/.claude-plugin/types/` は Claude Code が読み込んだ時に作る。無い時は `claude --plugin-dir plugins/<名前>` で一度読み込む |
| 振る舞いを変える PR | `plugin.json` の `version` を上げる。上げないと `/plugin marketplace update` をしても、入れた写しが変わらない |
| 上げない変更 | tests・README・文書だけの変更 |
| 上げ方 | [docs/development.md](docs/development.md) の「バージョンの上げ方」 |

## コードの書き方

| 決まり | 中身 |
| --- | --- |
| hooks の名前 | `hooks/register.ts` か `register.tsx`。plugin-authoring の慣例の名前なので変えない |
| 既定値 | コードの fallback は 1 つの定数にまとめる。値は `userConfig` の `default` と同じにする |
| 非同期 | `void` で捨てる処理には `.catch` を付け、失敗はトーストで知らせる |

## プラグインの足し方

足し方は [docs/development.md](docs/development.md) の「足し方」に従う。`tsconfig.json`、`types/`、`tests/` を置く。`version` は `0.1.0` から始める。

## そのほか

名前・文書・commit・PR の決まりは、claude-config の決まりに従う。
