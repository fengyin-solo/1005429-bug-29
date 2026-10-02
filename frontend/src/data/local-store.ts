import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 避险场所下挂的转移核对台账：转移确认的结果落在这份记录里，受威胁对象数据不与它混存。
export const TRANSFER_LEDGER_KEY = 'transfer-ledger'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-patrol:entries'

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
    // 以种子为底再叠加用户数据：版本升级新增的种子键（如转移台账）老缓存里没有时也能补齐，
    // 绝不能让用户缓存里缺键导致两处数据对不上。
    return { ...fallback, ...parsed }
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
  saveBatch({ [key]: rows })
}

// 一次落库：转移要同时改对象、写转移台账、更新已接收人数，必须同一次写入，
// 不能先改一份再改另一份，否则刷新后会看到转移前的旧值。
export function saveBatch(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
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
