/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  /** 业务主数据用数字主键；避险场所内的台账核对项用台账编号（字符串）做主键。 */
  id: number | string
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
  /** 受威胁对象转移口径：与详情抽屉取自同一个 threatStats() 结果。 */
  threat: ThreatStats
}

/** 受威胁对象：状态单向流转：待登记 → 已登记 → 已转移 → 已解除，不开回头口子。 */
export const THREAT_STATUSES = ['待登记', '已登记', '已转移', '已解除'] as const
export type ThreatStatus = (typeof THREAT_STATUSES)[number]

/** 受威胁对象转移口径的运营指标：概览与详情抽屉共用这一个结果，保证两处对得上。 */
export type ThreatStats = {
  registeredCount: number
  transferredCount: number
  releasedCount: number
  /** 涉及人数合计：已转移、已解除对象按实际转移口径重算后的人数汇总。 */
  affectedPeopleTotal: number
  /** 转移核对：避险场所台账核对项条数，以及人数对得上的条数。 */
  ledgerEntryCount: number
  ledgerMatchedCount: number
}

/** 转移提交内容：实际转移人数以现场核对为准，最近距离按转移后复测值登记。 */
export type TransferPayload = {
  transferredPeople: number
  measuredDistance: number
  refugeId: number
}

/** 登记提交内容：同一对象编号重复提交只认第一次。 */
export type RegisterPayload = {
  对象编号: string
  所属隐患点: string
  对象类型: string
  对象名称: string
  登记人数: number
  最近距离: number
  联系人: string
}

/** 转移核对项：转移结果落到避险场所台账上的记录。 */
export type TransferLedgerEntry = {
  id: string
  kind: 'transfer-check'
  对象编号: string
  对象类型: string
  对象名称: string
  场所编号: string
  场所名称: string
  /** 台账登记的转移人数，须与受威胁对象按实际转移口径重算后的涉及人数一致。 */
  转移人数: number
  复测距离: number
  转移日期: string
  核对结果: '人数一致' | '人数不符'
}
