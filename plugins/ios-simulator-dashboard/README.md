# ios-simulator-dashboard

iOS のシミュレータの今の状態と、この会話でシミュレータにしたことを、右の pane に出す Claude Code のプラグイン。

## ✨ 出すもの

| 表 | 中身 |
| --- | --- |
| シミュレータ | 起動中の 1 台ごとに、名前、OS、UDID の頭の 8 文字、外観（ライト・ダーク）。起動中が無ければ「起動中のシミュレータはありません」と、使えるシミュレータの数 |
| アプリ | `bundleId` を設定した時だけ。入っているかと、動いているか。下の罫線に bundle ID |
| この会話でしたこと | 新しい順に 6 件。何秒前・何分前か、成功（`✓`）か失敗（`✖`）か、したこと、かかった時間、相手（bundle ID やファイルの名前） |
| まとめ | シミュレータの起動、インストール、アプリの起動の回数、スクリーンショットの枚数と最後に撮った時刻、失敗の数 |

履歴には、次の 2 つを拾う。サブエージェントがしたことも拾う。

| 元 | 拾うもの |
| --- | --- |
| XcodeBuildMCP のツール | `boot_sim`・`open_sim`・`install_app_sim`・`launch_app_sim`・`stop_app_sim`・`build_run_sim`・`screenshot`・`snapshot_ui`・`record_sim_video` |
| Bash の `xcrun simctl` | `boot`・`shutdown`・`erase`・`install`・`uninstall`・`launch`・`terminate`・`openurl`・`io screenshot`・`io recordVideo`・`ui appearance <値>`・`push`・`privacy`・`status_bar`・`addmedia`・`location`。`list` のように読むだけのものは拾わない |

数え方は次のとおり。

| 決まり | 中身 |
| --- | --- |
| 回数 | 成功した分だけ数える。`build_run_sim` は、インストールとアプリの起動の両方に数える |
| 失敗 | 断られた・エラーを返した呼び出しを、1 回につき 1 と数える |
| 1 つのコマンドに並んだ操作 | `&&` や `;` で並べた `xcrun simctl` は、1 件ずつ履歴に出す。成功か失敗かと時間は、コマンド全体のものにする |
| `/clear` | 履歴と回数を初めに戻す |

## 📦 入れ方

```sh
/plugin install ios-simulator-dashboard --marketplace yossibank/claude-plugins
```

## 🚀 コマンド

| コマンド | 中身 |
| --- | --- |
| `/simulator` | 右の pane を開いて、シミュレータの状態を取る |

## 🖥️ ペイン

シミュレータの状態は `xcrun simctl` で取る。取り直すのは次の時。pane を閉じている間は、`xcrun` を走らせない。

| 時 | 中身 |
| --- | --- |
| pane を開いた時 | `/simulator`、`autoOpen`、ほかの方法で開いた時（2 秒おきの見張りが見つける） |
| 操作の後 | 上の表のツールやコマンドが終わった後 |
| `r` を押した時 | すぐに取り直す |
| `refreshSeconds` ごと | pane が出ている間だけ |

`xcrun` が無い時や失敗した時は、「シミュレータの状態を取れません」と理由を出す。

ボタンは、pane に focus がある間、キー 1 つで押せる。

| キー | ボタン |
| --- | --- |
| `r` | 更新 |
| `s` | 前に出す。Simulator.app を前に出す（`open -a Simulator`） |
| `d` | 外観。起動中のシミュレータを、ライトとダークで切り替える |
| `x` | 閉じる |

シミュレータを変える操作は `s` と `d` だけ。起動・停止・インストールはしない。

[ルートの README の入れ方](../../README.md#-入れ方)

## 🔧 設定

| 設定 | 既定 | 中身 |
| --- | --- | --- |
| `bundleId` | 空 | 入っているか・動いているかを出すアプリの bundle ID。空なら、アプリの行を出さない |
| `refreshSeconds` | `10` | pane が出ている間、状態を取り直す間隔（秒） |
| `autoOpen` | `false` | `true` なら、上の表のツールかコマンドを初めて使った時に、pane を開く。入力の focus は取らない |
