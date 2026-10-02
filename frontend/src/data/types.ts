/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 状态严格按 statuses 顺序单向推进，不允许跳级，更不允许回头。
  linearFlow?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 受威胁对象的汇总口径：列表卡片、详情抽屉、运营概览都从这同一份结果取值，避免各算各的。
export type ThreatSummary = {
  // 已登记对象：已登记 / 已转移 / 已解除（待登记草稿不计）
  registeredCount: number
  // 已转移对象：已转移 / 已解除（解除必须先经过转移）
  transferredCount: number
  releasedCount: number
  // 涉及人数合计：登记后按登记口径、转移后按实际转移口径，全部取自落库的同一字段
  peopleTotal: number
  // 已转移对象的实际转移人数合计（对象侧）
  transferredPeople: number
  // 避险场所转移台账接收人数合计（台账侧）
  ledgerPeople: number
  checkedCount: number
  mismatchCount: number
  // 对象侧与台账侧人数是否对得上
  reconciled: boolean
}
