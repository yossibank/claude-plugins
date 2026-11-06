# claude-plugins

自作の Claude Code のプラグインと mod を置くマーケットプレイス。

<img src="docs/images/tech.svg" alt="Claude Code">

## ✨ 機能

| プラグイン | できること |
| --- | --- |
| まだ無い | |

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
