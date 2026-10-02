<template>
  <section class="page" data-module="threat">
    <header class="page-head">
      <div>
        <h2>受威胁对象管理</h2>
        <p class="page-desc">
          维护受威胁对象，围绕对象编号、所属隐患点、对象类型、对象名称做登记、筛选与状态流转。
          状态单向流转：待登记 → 已登记 → 已转移 → 已解除；转移一次落库，概览与详情取同一份数据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记受威胁对象</button>
        <button class="btn" type="button" @click="exportRows">导出受威胁对象清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item" :class="{ 'legend-bad': !summary.reconciled }">
        台账比对：{{ summary.reconciled ? '人数一致' : '人数对不上' }}
        （对象侧 {{ summary.transferredPeople }} 人 / 台账侧 {{ summary.ledgerPeople }} 人）
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" @click="openDetail(row)" class="row-clickable">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.abnormal" class="tag tag-bad">退回核对</span>
          </td>
          <td class="row-actions" @click.stop>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无受威胁对象数据，可先登记受威胁对象</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条受威胁对象记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记弹窗 -->
    <div v-if="showCreate" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记受威胁对象</h3>
        <p class="modal-tip">先落「待登记」草稿；提交登记时再按业务口径核对，同一对象编号只认第一次提交。</p>
        <form class="modal-form" @submit.prevent="submitCreate">
          <label v-for="field in formFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="createForm[field]" :placeholder="field === '最近距离' ? '单位米，须在 0~1000 之间' : `请输入${field}`" />
          </label>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
            <button class="btn primary" type="submit">保存登记</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 转移确认弹窗 -->
    <div v-if="transferTarget" class="modal-mask" @click.self="closeTransfer">
      <div class="modal">
        <h3>确认转移</h3>
        <p class="modal-tip">
          对象 {{ String(transferTarget.对象编号) }}（{{ String(transferTarget.对象类型) }}）。
          转移人数按对象类型口径重算：人员类按实际人数，道路/农田等物类记 0；转移结果一次落库并写入避险场所转移台账。
        </p>
        <form class="modal-form" @submit.prevent="submitTransfer">
          <label class="form-item">
            <span>避险场所（仅已启用且容量充足）</span>
            <select v-model="transferForm.refugeCode">
              <option value="" disabled>请选择避险场所</option>
              <option v-for="refuge in refuges" :key="String(refuge.场所编号)" :value="String(refuge.场所编号)">
                {{ String(refuge.场所编号) }} · {{ String(refuge.场所名称) }}
                （已接收 {{ receivedOf(refuge) }} / 容纳 {{ refuge.可容纳人数 }}）
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>实际转移人数（对象类型口径：{{ canonicalOf(transferTarget) }} 人）</span>
            <input v-model="transferForm.people" type="number" min="0" />
          </label>
          <label class="form-item">
            <span>转移核对人</span>
            <input v-model="transferForm.checker" placeholder="请输入转移核对人" />
          </label>
          <p v-if="transferError" class="error-text">{{ transferError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeTransfer">取消</button>
            <button class="btn primary" type="submit">确认转移并落台账</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 详情抽屉：与列表对着同一条记录（从同一份 rows 中按 id 取） -->
    <div v-if="detailId !== null" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>受威胁对象详情</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <template v-if="detailRow">
          <dl class="detail-list">
            <div v-for="column in columns" :key="column" class="detail-item">
              <dt>{{ column }}</dt>
              <dd>{{ detailRow[column] ?? '—' }}</dd>
            </div>
            <div class="detail-item">
              <dt>当前状态（持久化口径）</dt>
              <dd>{{ detailRow.status }}<span v-if="detailRow.abnormal" class="tag tag-bad">退回核对</span></dd>
            </div>
            <div class="detail-item">
              <dt>对象类型口径人数</dt>
              <dd>{{ canonicalOf(detailRow) }} 人</dd>
            </div>
            <template v-if="Number(detailRow.转移人数) > 0 || detailRow.避险场所编号">
              <div class="detail-item"><dt>实际转移人数</dt><dd>{{ detailRow.转移人数 ?? 0 }} 人</dd></div>
              <div class="detail-item"><dt>转入避险场所</dt><dd>{{ detailRow.避险场所编号 }} · {{ detailRow.避险场所名称 }}</dd></div>
              <div class="detail-item"><dt>转移日期</dt><dd>{{ detailRow.转移日期 ?? '—' }}</dd></div>
              <div class="detail-item"><dt>转移核对人</dt><dd>{{ detailRow.转移核对人 ?? '—' }}</dd></div>
            </template>
            <div v-if="detailRow.退回原因" class="detail-item">
              <dt>退回原因</dt>
              <dd class="error-text">{{ detailRow.退回原因 }}</dd>
            </div>
          </dl>
          <div class="drawer-actions">
            <button
              v-for="action in actionsFor(detailRow)"
              :key="action"
              class="btn"
              :class="{ primary: action === '确认转移' }"
              type="button"
              @click="runAction(action, detailRow)"
            >
              {{ action }}
            </button>
          </div>
        </template>
        <p v-else class="empty-state">该记录已不存在</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  availableRefuges,
  canonicalPeople,
  confirmThreatTransfer,
  createThreat,
  downloadEntries,
  getThreatSummary,
  listEntries,
  moduleMeta,
  releaseThreat,
  submitThreatRegistration,
} from '@/api/local-service'
import type { EntryRow, ThreatSummary } from '@/data/types'

const meta = moduleMeta('threat')
const columns = ['对象编号', '所属隐患点', '对象类型', '对象名称', '涉及人数', '最近距离', '联系人', '对象状态']
const formFields = ['对象编号', '所属隐患点', '对象类型', '对象名称', '涉及人数', '最近距离', '联系人']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 汇总与页面共用一份持久化数据：reload 时同步重算，重开页面、刷新都不会跳回旧值。
const summary = ref<ThreatSummary>({
  registeredCount: 0,
  transferredCount: 0,
  releasedCount: 0,
  peopleTotal: 0,
  transferredPeople: 0,
  ledgerPeople: 0,
  checkedCount: 0,
  mismatchCount: 0,
  reconciled: true,
})

const statCards = computed(() => [
  { label: '已登记对象', value: summary.value.registeredCount },
  { label: '已转移对象', value: summary.value.transferredCount },
  { label: '涉及人数合计', value: summary.value.peopleTotal },
  { label: '已解除对象', value: summary.value.releasedCount },
  { label: '台账转移核对', value: `${summary.value.checkedCount}/${summary.value.transferredCount}` },
])

const statuses = ['待登记', '已登记', '已转移', '已解除']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 单向流转的上下文动作：每个状态只暴露下一步，回头的口子不开。
function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待登记':
      return ['提交登记']
    case '已登记':
      return ['确认转移']
    case '已转移':
      return ['登记解除']
    default:
      return []
  }
}

function canonicalOf(row: EntryRow): number {
  return canonicalPeople(row)
}

function receivedOf(refuge: EntryRow): number {
  // 已接收人数直接读台账，与转移一次落库的口径保持一致。
  return listEntries('transfer-ledger').items
    .filter((item) => String(item.避险场所编号) === String(refuge.场所编号))
    .reduce((sum, item) => sum + (Number(item.转移人数) || 0), 0)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = getThreatSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '受威胁对象列表读取失败'
  }
}

// ---- 登记 ----
const showCreate = ref(false)
const createError = ref('')
const emptyForm = (): Record<string, string> =>
  Object.fromEntries(formFields.map((field) => [field, '']))
const createForm = ref<Record<string, string>>(emptyForm())

function openCreate() {
  createForm.value = emptyForm()
  createError.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

function submitCreate() {
  const result = createThreat(createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  showCreate.value = false
  reload()
}

// ---- 转移 ----
const transferTarget = ref<EntryRow | null>(null)
const transferError = ref('')
const transferForm = ref<{ refugeCode: string; people: number; checker: string }>({
  refugeCode: '',
  people: 0,
  checker: '',
})
const refuges = ref<EntryRow[]>([])

function openTransfer(row: EntryRow) {
  transferTarget.value = row
  transferError.value = ''
  refuges.value = availableRefuges()
  transferForm.value = { refugeCode: '', people: canonicalPeople(row), checker: '' }
}

function closeTransfer() {
  transferTarget.value = null
}

function submitTransfer() {
  if (!transferTarget.value) {
    return
  }
  const result = confirmThreatTransfer(Number(transferTarget.value.id), transferForm.value)
  if (!result.ok) {
    transferError.value = result.message
    return
  }
  transferTarget.value = null
  reload()
}

// ---- 解除 ----
function release(row: EntryRow) {
  const result = releaseThreat(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

// ---- 动作分发 ----
function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '提交登记') {
    const result = submitThreatRegistration(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
    }
    reload()
    return
  }
  if (action === '确认转移') {
    openTransfer(row)
    return
  }
  if (action === '登记解除') {
    release(row)
    return
  }
  errorMessage.value = `没有登记「${action}」这个动作`
}

// ---- 详情抽屉：始终按 id 从当前 rows（与列表同源）取记录 ----
const detailId = ref<number | null>(null)
const detailRow = computed(() =>
  detailId.value === null ? null : rows.value.find((row) => Number(row.id) === detailId.value) ?? null,
)

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
}

function closeDetail() {
  detailId.value = null
}

onMounted(reload)
</script>
