import type { Register } from 'claude-code'

const CREATE = new RegExp(['\\bgh', 'pr', 'create\\b'].join('\\s+'))
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g
const NARROW_COLUMNS = 128

export const register: Register = on => {
  let columns: number | undefined

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport !== undefined) columns = e.viewport.columns
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !CREATE.test(e.command)) return ran

    const url = ran.text?.match(PR_URL)?.at(-1)
    if (url === undefined) return ran

    const split = columns !== undefined && columns < NARROW_COLUMNS ? 'down' : 'right'
    void $.process
      .run(['terminal-browser', 'open', url, '--split', split])
      .then(({ exitCode, stderr }) => {
        if (exitCode !== 0) $.ui.toast(`pr-browser: 開けませんでした: ${stderr.trim().slice(0, 80)}`)
      })
      .catch(() => $.ui.toast('pr-browser: terminal-browser が見つかりません'))

    return ran
  })
}
