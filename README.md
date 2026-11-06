# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。全リポジトリ共通の決まりは [claude-config](https://github.com/yossibank/claude-config) にある。

![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white)

## 🚀 入れ方

Claude Code で、マーケットプレイスを足してからプラグインを入れる。

```text
/plugin marketplace add yossibank/claude-plugins
/plugin install <プラグイン>@yossibank
```

入れた後は `/reload-plugins` で読み込む。

## 📦 プラグイン

| プラグイン | できること |
| --- | --- |
| まだ無い | |

## 🛠️ 足し方

プラグインは `plugins/<名前>/` に置き、`.claude-plugin/marketplace.json` の `plugins` に足す。足したら次で検査する。

```sh
claude plugin validate .
```
