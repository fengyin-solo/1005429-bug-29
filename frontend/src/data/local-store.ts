import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 升级种子/口径时抬版本号，旧缓存整体作废，避免重开页面时旧值回潮把新数字压回去。
const STORAGE_KEY = 'geohazard-patrol:entries:v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 逐模块与种子合并：新增模块在旧缓存里没有时补上种子。
    const merged: Record<string, EntryRow[]> = { ...fallback }
    for (const key of Object.keys(fallback)) {
      if (Array.isArray(parsed[key])) {
        merged[key] = parsed[key]
      }
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  saveAll({ [key]: rows })
}

/**
 * 一次落库：多模块联动（如受威胁对象转移 + 避险场所台账核对项）合并为一次写入，
 * 列表与详情共用同一份持久化结果，不允许先改内存再分别保存。
 */
export function saveAll(patch: Partial<Record<string, EntryRow[]>>): void {
  const next: Record<string, EntryRow[]> = { ...allRows() }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[key] = value
    }
  }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
