import type { Register } from 'claude-code'

const CREATE = /\bgh\s+pr\s+create\b/
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !CREATE.test(e.command)) return ran

    const url = ran.text?.match(PR_URL)?.[0]
    if (url === undefined) return ran

    void $.process
      .run(['terminal-browser', 'open', url, '--split', 'right'])
      .then(({ exitCode, stderr }) => {
        if (exitCode !== 0) $.ui.toast(`pr-browser: 開けませんでした: ${stderr.trim().slice(0, 80)}`)
      })
      .catch(() => $.ui.toast('pr-browser: terminal-browser が見つかりません'))

    return ran
  })
}
