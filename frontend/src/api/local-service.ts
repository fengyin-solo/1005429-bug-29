import { MODULE_BY_KEY } from '@/data/modules'
import { TRANSFER_LEDGER_KEY, allRows, listRows, resetRows, saveBatch, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult, ThreatSummary } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 受威胁对象的业务口径 ----------------------------------------------------------
// 状态严格单向：待登记 → 已登记 → 已转移 → 已解除，不允许跳级、不允许回头。
const THREAT_KEY = 'threat'

// 对象类型谁说了算：是否计入涉及人数只认对象类型，最近距离不参与人数判定。
// 人员密集 / 长期有人的类型按实际人数统计；设施、线路、土地等物的类型没有人员口径，记 0。
const PERSON_OBJECT_TYPES = ['居民', '住户', '学校', '小学', '中学', '教学点', '医院', '卫生院', '幼儿园', '企业', '工厂', '商户', '单位', '安置点', '敬老院']
const PROPERTY_OBJECT_TYPES = ['农田', '耕地', '道路', '公路', '桥梁', '管线', '线路', '设施', '厂房构筑物', '土地']

// 最近距离的业务极值口径（米）：距离为非正数、空值、非数字或达到/超过该极值，
// 一律视为取数不可信，退回核对，不允许提交登记或确认转移。
const DISTANCE_EXTREME = 1000

function threatRows(): EntryRow[] {
  return listRows(THREAT_KEY)
}

export function isPersonObjectType(type: string): boolean {
  const value = String(type ?? '').trim()
  if (PROPERTY_OBJECT_TYPES.some((token) => value.includes(token))) {
    return false
  }
  return PERSON_OBJECT_TYPES.some((token) => value.includes(token))
}

// 对象类型决定人数口径：物的类型即使填了人数也不计入（返回 0）。
export function canonicalPeople(row: EntryRow): number {
  if (!isPersonObjectType(String(row.对象类型 ?? ''))) {
    return 0
  }
  const value = Number(row.涉及人数)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

export function parseDistance(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  const text = String(value ?? '').trim().replace(/米$/, '')
  if (text === '') {
    return null
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

// 最近距离取到极值（含空值、非正数、非数字、达到/超过极值）一律退回核对。
export function isExtremeDistance(value: unknown): boolean {
  const distance = parseDistance(value)
  return distance === null || distance <= 0 || distance >= DISTANCE_EXTREME
}

function findThreat(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = threatRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function nextThreatId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function toThreatRow(id: number, draft: Record<string, string>): EntryRow {
  return {
    id,
    status: '待登记',
    pending: true,
    abnormal: false,
    对象编号: draft.对象编号.trim(),
    所属隐患点: draft.所属隐患点.trim(),
    对象类型: draft.对象类型.trim(),
    对象名称: draft.对象名称.trim(),
    涉及人数: Math.max(0, Number(draft.涉及人数) || 0),
    最近距离: draft.最近距离.trim(),
    联系人: draft.联系人.trim(),
    对象状态: '待登记',
  }
}

// 登记受威胁对象（先落一条待登记草稿）。同一对象编号只认第一次的结果。
export function createThreat(draft: Record<string, string>): ActionResult {
  const fields = ['对象编号', '所属隐患点', '对象类型', '对象名称', '涉及人数', '最近距离', '联系人']
  for (const field of fields) {
    if (String(draft[field] ?? '').trim() === '') {
      return { ok: false, message: `${field}不能为空` }
    }
  }
  if (!Number.isFinite(Number(draft.涉及人数)) || Number(draft.涉及人数) < 0) {
    return { ok: false, message: '涉及人数必须是不小于 0 的数字' }
  }
  const rows = threatRows()
  const code = draft.对象编号.trim()
  if (rows.some((row) => String(row.对象编号) === code)) {
    return { ok: false, message: `对象编号 ${code} 已存在，同一对象编号只认第一次提交的结果` }
  }
  const row = toThreatRow(nextThreatId(rows), draft)
  saveRows(THREAT_KEY, [...rows, row])
  return { ok: true, message: `受威胁对象 ${code} 已登记为草稿，当前状态「待登记」` }
}

// 提交登记：待登记 → 已登记。距离取到极值一律退回核对（不落已登记）。
export function submitThreatRegistration(id: number): ActionResult {
  const found = findThreat(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的受威胁对象` }
  }
  const { rows, index } = found
  const row = rows[index]
  if (String(row.status) !== '待登记') {
    return { ok: false, message: `只有待登记对象才能提交登记，当前状态「${row.status}」` }
  }
  if (isExtremeDistance(row.最近距离)) {
    const updated: EntryRow = {
      ...row,
      abnormal: true,
      对象状态: '退回核对',
      退回原因: `最近距离 ${String(row.最近距离 || '空')} 取到极值（应在 0~${DISTANCE_EXTREME} 米之间），退回核对`,
    }
    const next = [...rows]
    next[index] = updated
    saveRows(THREAT_KEY, next)
    return {
      ok: false,
      message: `最近距离 ${String(row.最近距离 || '空')} 取到极值（应在 0~${DISTANCE_EXTREME} 米之间），已退回核对`,
    }
  }
  const updated: EntryRow = {
    ...row,
    status: '已登记',
    pending: true,
    abnormal: false,
    对象状态: '已登记',
    涉及人数: canonicalPeople(row),
    退回原因: '',
  }
  const next = [...rows]
  next[index] = updated
  saveRows(THREAT_KEY, next)
  return { ok: true, message: `对象 ${String(row.对象编号)} 已登记，涉及人数按对象类型口径记 ${updated.涉及人数} 人` }
}

// 可承接转移的避险场所：已启用且接收后不超过可容纳人数。
export function availableRefuges(): EntryRow[] {
  return listRows('refuge')
    .filter((row) => String(row.status) === '已启用')
    .filter((row) => receivedAtRefuge(String(row.场所编号)) < Number(row.可容纳人数))
}

function receivedAtRefuge(refugeCode: string): number {
  return listRows(TRANSFER_LEDGER_KEY)
    .filter((item) => String(item.避险场所编号) === refugeCode)
    .reduce((sum, item) => sum + (Number(item.转移人数) || 0), 0)
}

export type TransferInput = {
  refugeCode: string
  people: number
  checker: string
}

// 确认转移：已登记 → 已转移。对象、台账、场所接收人数一次落库，不允许只改其中一份。
export function confirmThreatTransfer(id: number, input: TransferInput): ActionResult {
  const found = findThreat(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的受威胁对象` }
  }
  const { rows, index } = found
  const row = rows[index]
  if (String(row.status) !== '已登记') {
    return { ok: false, message: `只有已登记对象才能确认转移，当前状态「${row.status}」，状态只能往前走` }
  }
  const refuge = listRows('refuge').find((item) => String(item.场所编号) === input.refugeCode.trim())
  if (!refuge) {
    return { ok: false, message: '请选择有效的避险场所' }
  }
  if (String(refuge.status) !== '已启用') {
    return { ok: false, message: `避险场所 ${String(refuge.场所编号)} 当前为「${refuge.status}」，不能承接转移` }
  }
  const people = Math.trunc(Number(input.people))
  if (!Number.isFinite(people) || people < 0) {
    return { ok: false, message: '转移人数必须是不小于 0 的数字' }
  }
  // 对象类型说了算：物的类型不产生人员转移。
  const canonical = canonicalPeople(row)
  if (people !== canonical) {
    return { ok: false, message: `转移人数 ${people} 与对象类型「${String(row.对象类型)}」的口径 ${canonical} 人不一致，请按实际转移口径核对` }
  }
  const capacity = Number(refuge.可容纳人数)
  const received = receivedAtRefuge(String(refuge.场所编号))
  if (received + people > capacity) {
    return { ok: false, message: `避险场所 ${String(refuge.场所编号)} 容量不足：已接收 ${received} 人，本次 ${people} 人，上限 ${capacity} 人` }
  }
  const checker = input.checker.trim()
  if (!checker) {
    return { ok: false, message: '请填写转移核对人' }
  }

  const updated: EntryRow = {
    ...row,
    status: '已转移',
    pending: false,
    abnormal: false,
    涉及人数: people,
    转移人数: people,
    避险场所编号: String(refuge.场所编号),
    避险场所名称: String(refuge.场所名称),
    转移日期: new Date().toISOString().slice(0, 10),
    转移核对人: checker,
    对象状态: '已转移',
    退回原因: '',
  }
  const nextThreat = [...rows]
  nextThreat[index] = updated

  // 转移结果落到避险场所台账，并添记转移核对项（默认待核对，由场所侧比对人数）。
  const ledger = listRows(TRANSFER_LEDGER_KEY)
  const entry: EntryRow = {
    id: ledger.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: '待核对',
    pending: true,
    abnormal: false,
    对象编号: String(row.对象编号),
    对象类型: String(row.对象类型),
    对象名称: String(row.对象名称),
    所属隐患点: String(row.所属隐患点),
    避险场所编号: String(refuge.场所编号),
    避险场所名称: String(refuge.场所名称),
    涉及人数: people,
    转移人数: people,
    登记人数: Number(row.涉及人数) || 0,
    转移日期: updated.转移日期 as string,
    转移核对人: checker,
    转移核对项: '待核对',
  }

  // 一次落库：对象表与台账同一次写入，刷新或重开页面都不会回到转移前的旧值。
  saveBatch({ [THREAT_KEY]: nextThreat, [TRANSFER_LEDGER_KEY]: [...ledger, entry] })
  return {
    ok: true,
    message: `对象 ${String(row.对象编号)} 已转移至 ${String(refuge.场所名称)}，实际转移 ${people} 人，结果已记入避险场所转移台账`,
  }
}

// 登记解除：已转移 → 已解除（解除必须先经过转移）。
export function releaseThreat(id: number): ActionResult {
  const found = findThreat(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的受威胁对象` }
  }
  const { rows, index } = found
  const row = rows[index]
  if (String(row.status) !== '已转移') {
    return { ok: false, message: `只有已转移对象才能登记解除，当前状态「${row.status}」，状态只能往前走` }
  }
  const updated: EntryRow = { ...row, status: '已解除', 对象状态: '已解除' }
  const next = [...rows]
  next[index] = updated
  saveRows(THREAT_KEY, next)
  return { ok: true, message: `对象 ${String(row.对象编号)} 已解除，状态「已解除」` }
}

export function transferLedger(): EntryRow[] {
  return listRows(TRANSFER_LEDGER_KEY)
}

// 台账转移核对：把台账人数与对象记录上的人数做比对，两边对得上才记「核对一致」。
export function checkTransferEntry(ledgerId: number): ActionResult {
  const ledger = transferLedger()
  const index = ledger.findIndex((item) => Number(item.id) === ledgerId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${ledgerId} 的转移台账记录` }
  }
  const entry = ledger[index]
  const threat = threatRows().find((row) => String(row.对象编号) === String(entry.对象编号))
  if (!threat) {
    const next = [...ledger]
    next[index] = { ...entry, status: '核对异常', pending: false, abnormal: true, 转移核对项: '核对异常', 核对说明: '找不到对应受威胁对象记录' }
    saveRows(TRANSFER_LEDGER_KEY, next)
    return { ok: false, message: '台账对象在受威胁对象记录中不存在，已标记核对异常' }
  }
  const objectPeople = Number(threat.转移人数 ?? threat.涉及人数) || 0
  const ledgerPeople = Number(entry.转移人数) || 0
  const matched = objectPeople === ledgerPeople
  const next = [...ledger]
  next[index] = {
    ...entry,
    status: matched ? '核对一致' : '核对异常',
    pending: !matched,
    abnormal: !matched,
    转移核对项: matched ? '核对一致' : '核对异常',
    核对说明: matched
      ? `台账 ${ledgerPeople} 人与对象记录 ${objectPeople} 人一致`
      : `台账 ${ledgerPeople} 人与对象记录 ${objectPeople} 人对不上，退回核对`,
  }
  saveRows(TRANSFER_LEDGER_KEY, next)
  return matched
    ? { ok: true, message: `对象 ${String(entry.对象编号)} 转移核对一致（${objectPeople} 人）` }
    : { ok: false, message: `对象 ${String(entry.对象编号)} 人数对不上：台账 ${ledgerPeople} 人，对象记录 ${objectPeople} 人` }
}

// 受威胁对象的统一汇总口径：概览卡片、详情抽屉、运营概览全部调用它，取数永远一致。
export function getThreatSummary(): ThreatSummary {
  const rows = threatRows()
  const registeredRows = rows.filter((row) => ['已登记', '已转移', '已解除'].includes(String(row.status)))
  const transferredRows = rows.filter((row) => ['已转移', '已解除'].includes(String(row.status)))
  const peopleTotal = registeredRows.reduce((sum, row) => sum + canonicalPeople(row), 0)
  const transferredPeople = transferredRows.reduce((sum, row) => sum + (Number(row.转移人数 ?? row.涉及人数) || 0), 0)

  const ledger = transferLedger()
  const ledgerPeople = ledger.reduce((sum, item) => sum + (Number(item.转移人数) || 0), 0)
  const checkedCount = ledger.filter((item) => String(item.转移核对项) === '核对一致').length
  const mismatchCount = ledger.filter((item) => String(item.转移核对项) === '核对异常').length

  return {
    registeredCount: registeredRows.length,
    transferredCount: transferredRows.length,
    releasedCount: rows.filter((row) => String(row.status) === '已解除').length,
    peopleTotal,
    transferredPeople,
    ledgerPeople,
    checkedCount,
    mismatchCount,
    reconciled: transferredPeople === ledgerPeople && mismatchCount === 0,
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 单向流转：状态只能沿 statuses 向前推进一步，跳级、回头、重复提交一律不认。
  if (meta.linearFlow) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (currentIndex < 0 || targetIndex <= currentIndex) {
      return { ok: false, message: `${meta.entity}状态只能单向推进，不能从「${current}」回到「${target}」` }
    }
    if (targetIndex !== currentIndex + 1) {
      return { ok: false, message: `${meta.entity}需先流转到「${meta.statuses[currentIndex + 1]}」，不能跳到「${target}」` }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  // transfer-ledger 是避险场所下挂的内部台账，不单独作为业务模块计数。
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
