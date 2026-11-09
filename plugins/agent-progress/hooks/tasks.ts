import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { TaskItem, Tasks } from '../types'

import { textOf } from './tool'
import type { Args } from './tool'

const NO_TASKS: Tasks = { items: [], current: null }
const tasks = atom({ plugin: 'agent-progress', key: 'tasks' } as const, NO_TASKS)

export const taskLineOf = (list: Tasks) => {
  const task = list.items.find(item => item.id === list.current)
  return task === undefined ? null : task.activeForm || task.subject || null
}

const pick = (e: Args, key: 'subject' | 'activeForm') => {
  const value = textOf(e, key)
  return value === undefined ? {} : { [key]: value }
}

type Todo = { content?: string; activeForm?: string; status?: string }

const statusOf = (status: string | undefined): TaskItem['status'] => (status === 'in_progress' || status === 'completed' ? status : 'pending')

// TaskCreate・TaskUpdate・TodoWrite から、作業の一覧と作業中の項目を追う
const trackOf = (list: Tasks, e: Args, result: unknown): Tasks => {
  if (e.tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id
    const subject = textOf(e, 'subject')
    if (id === undefined || subject === undefined) return list
    return { ...list, items: [...list.items.filter(item => item.id !== id), { id, subject, ...pick(e, 'activeForm'), status: 'pending' }] }
  }
  if (e.tool === 'TaskUpdate') {
    const id = textOf(e, 'taskId')
    if (id === undefined) return list
    const status = textOf(e, 'status')
    if (status === 'deleted') return { items: list.items.filter(item => item.id !== id), current: list.current === id ? null : list.current }
    const before = list.items.find(item => item.id === id)
    const item: TaskItem = { subject: '', status: 'pending', ...before, id, ...pick(e, 'subject'), ...pick(e, 'activeForm'), ...(status === undefined ? {} : { status: statusOf(status) }) }
    const items = before === undefined ? [...list.items, item] : list.items.map(found => (found.id === id ? item : found))
    const current = status === 'in_progress' ? id : status === 'completed' && list.current === id ? null : list.current
    return { items, current }
  }
  if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
    const items = (e.todos as Todo[]).map((todo, index): TaskItem => ({
      id: `todo-${index}`,
      subject: todo.content ?? '',
      ...(todo.activeForm === undefined ? {} : { activeForm: todo.activeForm }),
      status: statusOf(todo.status),
    }))
    return { items, current: items.find(item => item.status === 'in_progress')?.id ?? null }
  }
  return list
}

export async function currentTasks($: EngineInterface) {
  return read($, tasks)
}

export async function trackTasks($: EngineInterface, e: Args, result: unknown) {
  await update($, tasks, now => trackOf(now, e, result))
}

export async function resetTasks($: EngineInterface) {
  await update($, tasks, () => NO_TASKS)
}
