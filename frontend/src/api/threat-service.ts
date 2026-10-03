import { listRows, saveAll } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  RegisterPayload,
  ThreatStats,
  TransferLedgerEntry,
  TransferPayload,
} from '@/data/types'
import { THREAT_STATUSES } from '@/data/types'

// 受威胁对象转移的全部业务口径集中在本文件：列表、详情抽屉、运营概览都只从这里取值。
const THREAT_KEY = 'threat'
const REFUGE_KEY = 'refuge'

// 对象类型中按「人员聚集对象」计人口的关键词：居民点、学校、卫生院/医院、敬老院、机关单位等。
// 业务口径：涉及人数由对象类型说了算——人员聚集对象按实际转移人数计，
// 通村公路、架空线路、耕地林地等非人员对象一律按 0 人计。
const POPULATED_TYPE_KEYWORDS = ['居民', '学校', '教学点', '医院', '卫生院', '养老', '敬养', '机关', '单位', '厂区', '安置', '农户', '住户', '集中']

// 最近距离的极值口径（米）：非正数或达到 1000 米及以上一律视为极值记录，转移提交一律退回核对。
// 业务口径：能不能转移由最近距离说了算；计多少人由对象类型说了算。
export const DISTANCE_EXTREME = 1000

export function isExtremeDistance(distance: number): boolean {
  return !Number.isFinite(distance) || distance <= 0 || distance >= DISTANCE_EXTREME
}

export function isPopulatedType(type: string): boolean {
  const text = String(type ?? '')
  return POPULATED_TYPE_KEYWORDS.some((keyword) => text.includes(keyword))
}

/** 转移口径重算：人员聚集对象按实际转移人数，其余对象类型一律 0 人。 */
export function recalcAffectedPeople(type: string, actualTransferred: number): number {
  if (!isPopulatedType(type)) {
    return 0
  }
  return Number.isFinite(actualTransferred) && actualTransferred > 0 ? Math.trunc(actualTransferred) : 0
}

function threatRows(): EntryRow[] {
  return listRows(THREAT_KEY)
}

function refugeRows(): EntryRow[] {
  return listRows(REFUGE_KEY)
}

export function findThreat(id: number): EntryRow | undefined {
  return threatRows().find((row) => Number(row.id) === id)
}

function findThreatByCode(code: string): EntryRow | undefined {
  return threatRows().find((row) => String(row['对象编号'] ?? '').trim() === code.trim())
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : NaN
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 单向流转：仅允许 待登记→已登记→已转移→已解除 相邻前进一步，回头与跳步一律不开口子。 */
function checkTransition(row: EntryRow, action: '提交登记' | '确认转移' | '登记解除'): ActionResult | null {
  const current = String(row.status)
  const required: Record<typeof action, (typeof THREAT_STATUSES)[number]> = {
    提交登记: '待登记',
    确认转移: '已登记',
    登记解除: '已转移',
  }
  if (current !== required[action]) {
    return fail(`对象当前为「${current}」，${action}要求处于「${required[action]}」；状态单向流转，不能回头或跳步`)
  }
  return null
}

/** 可作为转移去向的避险场所：可启用/已启用；已关闭、待核验不接收转移。 */
export function availableRefuges(): EntryRow[] {
  return refugeRows().filter(
    (row) => row.kind !== 'transfer-check' && (row.status === '可启用' || row.status === '已启用'),
  )
}

function ledgerEntries(): EntryRow[] {
  return refugeRows().filter((row) => row.kind === 'transfer-check')
}

function nextLedgerId(rows: EntryRow[]): string {
  const max = rows.reduce((highest, row) => {
    const code = String(row['台账编号'] ?? '')
    const matched = /^CHECK-(\d+)$/.exec(code)
    return matched ? Math.max(highest, Number(matched[1])) : highest
  }, 0)
  return `CHECK-${String(max + 1).padStart(4, '0')}`
}

/**
 * 运营概览与详情抽屉共用的统计：只从持久化的同一份数据现算，
 * 任何页面都不再自带一份人数口径，保证「两处比对下来，涉及人数对得上」。
 */
export function threatStats(): ThreatStats {
  const rows = threatRows()
  const ledger = ledgerEntries()
  let transferredCount = 0
  let releasedCount = 0
  let affectedPeopleTotal = 0
  for (const row of rows) {
    const status = String(row.status)
    const people = recalcAffectedPeople(String(row['对象类型'] ?? ''), toNumber(row['实际转移人数']))
    if (status === '已转移') {
      transferredCount += 1
      affectedPeopleTotal += people
    } else if (status === '已解除') {
      releasedCount += 1
      affectedPeopleTotal += people
    }
  }
  let ledgerMatchedCount = 0
  for (const item of ledger) {
    const code = String(item['对象编号'] ?? '')
    const target = findThreatByCode(code)
    const people = target
      ? recalcAffectedPeople(String(target['对象类型'] ?? ''), toNumber(target['实际转移人数']))
      : NaN
    if (people === Number(item['转移人数'])) {
      ledgerMatchedCount += 1
    }
  }
  return {
    registeredCount: rows.filter((row) => String(row.status) === '已登记').length,
    transferredCount,
    releasedCount,
    affectedPeopleTotal,
    ledgerEntryCount: ledger.length,
    ledgerMatchedCount,
  }
}

/** 登记受威胁对象：同一对象编号重复提交只认第一次的结果。 */
export function submitRegister(payload: RegisterPayload): ActionResult {
  const code = payload.对象编号.trim()
  if (!code) {
    return fail('对象编号不能为空')
  }
  if (findThreatByCode(code)) {
    return { ok: true, message: `对象编号「${code}」已提交过，重复提交只认第一次的结果，本次未作改动` }
  }
  const distance = Number(payload.最近距离)
  if (!Number.isFinite(distance)) {
    return fail('最近距离必须是数字')
  }
  if (isExtremeDistance(distance)) {
    return fail(`最近距离 ${distance} 米为极值（须大于 0 且小于 ${DISTANCE_EXTREME} 米），登记退回核对`)
  }
  const populated = isPopulatedType(payload.对象类型)
  const registeredPeople =
    populated && Number.isFinite(payload.登记人数) && payload.登记人数 > 0
      ? Math.trunc(payload.登记人数)
      : 0
  const rows = threatRows()
  const nextId = rows.reduce((highest, row) => Math.max(highest, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '已登记',
    pending: true,
    abnormal: false,
    对象编号: code,
    所属隐患点: payload.所属隐患点.trim(),
    对象类型: payload.对象类型.trim(),
    对象名称: payload.对象名称.trim(),
    登记人数: registeredPeople,
    涉及人数: registeredPeople,
    最近距离: distance,
    联系人: payload.联系人.trim(),
    对象状态: '已登记',
  }
  saveAll({ [THREAT_KEY]: [...rows, row] })
  return { ok: true, message: `对象「${code}」登记成功，状态「已登记」` }
}

/** 对「待登记」记录做首次确认：同样只认每一条对象编号的第一次结果。 */
export function confirmRegister(id: number): ActionResult {
  const row = findThreat(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的受威胁对象`)
  }
  const blocked = checkTransition(row, '提交登记')
  if (blocked) {
    return blocked
  }
  const rows = threatRows()
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated: EntryRow = { ...rows[index], status: '已登记', 对象状态: '已登记', pending: true }
  const next = [...rows]
  next[index] = updated
  saveAll({ [THREAT_KEY]: next })
  return { ok: true, message: `对象「${updated['对象编号']}」已提交登记，当前状态「已登记」` }
}

/**
 * 确认转移：一次落库。
 * 同一事务内完成：状态推进、涉及人数按实际转移口径重算、最近距离取复测值、
 * 避险场所台账添记转移核对项、场所已转入人数累加。
 */
export function confirmTransfer(id: number, payload: TransferPayload): ActionResult {
  const row = findThreat(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的受威胁对象`)
  }
  const blocked = checkTransition(row, '确认转移')
  if (blocked) {
    return blocked
  }
  // 同一对象编号重复提交：已转移/已解除的记录在上面的状态校验处即被拦下，只认第一次结果。
  const measuredDistance = Number(payload.measuredDistance)
  if (isExtremeDistance(measuredDistance)) {
    return fail(`复测最近距离 ${measuredDistance} 米为极值（须大于 0 且小于 ${DISTANCE_EXTREME} 米），一律退回核对，本次不落库`)
  }
  if (!Number.isFinite(payload.transferredPeople) || payload.transferredPeople < 0) {
    return fail('实际转移人数必须是不小于 0 的整数')
  }
  const refuge = refugeRows().find(
    (item) => item.kind !== 'transfer-check' && Number(item.id) === Number(payload.refugeId),
  )
  if (!refuge || (refuge.status !== '可启用' && refuge.status !== '已启用')) {
    return fail('请选择可启用或已启用的避险场所作为转移去向')
  }

  const actual = Math.trunc(payload.transferredPeople)
  const affected = recalcAffectedPeople(String(row['对象类型'] ?? ''), actual)
  if (isPopulatedType(String(row['对象类型'] ?? '')) && actual === 0) {
    return fail('人员聚集对象实际转移人数为 0，请现场核对后重新提交')
  }

  const capacity = toNumber(refuge['可容纳人数'])
  const occupied = toNumber(refuge['已转入人数'])
  if (Number.isFinite(capacity) && Number.isFinite(occupied) && occupied + affected > capacity) {
    return fail(`避险场所容量不足：已转入 ${occupied} 人，容量 ${capacity} 人，本次转入 ${affected} 人后超限`)
  }

  const threats = threatRows()
  const refuges = refugeRows()
  const threatIndex = threats.findIndex((item) => Number(item.id) === id)
  const refugeIndex = refuges.findIndex((item) => Number(item.id) === Number(payload.refugeId))

  const updatedThreat: EntryRow = {
    ...threats[threatIndex],
    status: '已转移',
    pending: false,
    abnormal: false,
    实际转移人数: actual,
    涉及人数: affected,
    最近距离: measuredDistance,
    转移去向编号: refuge['场所编号'],
    转移去向名称: refuge['场所名称'],
    转移日期: today(),
    对象状态: '已转移',
  }
  const updatedRefuge: EntryRow = {
    ...refuges[refugeIndex],
    已转入人数: (Number.isFinite(occupied) ? occupied : 0) + affected,
  }
  const ledgerId = nextLedgerId(refuges)
  const ledgerRow: EntryRow = {
    id: ledgerId,
    status: refuge.status,
    pending: false,
    abnormal: false,
    kind: 'transfer-check',
    台账编号: ledgerId,
    对象编号: updatedThreat['对象编号'],
    对象类型: updatedThreat['对象类型'],
    对象名称: updatedThreat['对象名称'],
    场所编号: refuge['场所编号'],
    场所名称: refuge['场所名称'],
    转移人数: affected,
    复测距离: measuredDistance,
    转移日期: today(),
    核对结果: '人数一致',
  }

  const nextThreats = [...threats]
  nextThreats[threatIndex] = updatedThreat
  const nextRefuges = [...refuges]
  nextRefuges[refugeIndex] = updatedRefuge
  nextRefuges.push(ledgerRow)
  // 一次落库：威胁对象与避险场所台账同时写盘，中途任何校验失败都在写盘前返回。
  saveAll({ [THREAT_KEY]: nextThreats, [REFUGE_KEY]: nextRefuges })
  return {
    ok: true,
    message: `对象「${updatedThreat['对象编号']}」已转移至「${updatedThreat['转移去向名称']}」，涉及人数按转移口径核定为 ${affected} 人，台账已添记 ${ledgerId}`,
  }
}

/** 登记解除：仅已转移对象可解除，状态继续单向推进，人数口径沿用转移时核定值。 */
export function releaseThreat(id: number): ActionResult {
  const row = findThreat(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的受威胁对象`)
  }
  const blocked = checkTransition(row, '登记解除')
  if (blocked) {
    return blocked
  }
  const rows = threatRows()
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated: EntryRow = { ...rows[index], status: '已解除', 对象状态: '已解除', pending: false }
  const next = [...rows]
  next[index] = updated
  saveAll({ [THREAT_KEY]: next })
  return { ok: true, message: `对象「${updated['对象编号']}」已解除，涉及人数沿用转移核定值 ${updated['涉及人数']} 人` }
}

/** 详情抽屉与列表同取这一份：按 id 直接读持久化结果，不做任何二次拷贝改写。 */
export function threatDetail(id: number): EntryRow | undefined {
  return findThreat(id)
}

export function transferLedger(): TransferLedgerEntry[] {
  return ledgerEntries().map((row) => ({
    id: String(row['台账编号'] ?? row.id),
    kind: 'transfer-check',
    对象编号: String(row['对象编号'] ?? ''),
    对象类型: String(row['对象类型'] ?? ''),
    对象名称: String(row['对象名称'] ?? ''),
    场所编号: String(row['场所编号'] ?? ''),
    场所名称: String(row['场所名称'] ?? ''),
    转移人数: toNumber(row['转移人数']),
    复测距离: toNumber(row['复测距离']),
    转移日期: String(row['转移日期'] ?? ''),
    核对结果: row['核对结果'] === '人数不符' ? '人数不符' : '人数一致',
  }))
}
