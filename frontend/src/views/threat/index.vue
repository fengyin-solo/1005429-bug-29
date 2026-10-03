<template>
  <section class="page" data-module="threat">
    <header class="page-head">
      <div>
        <h2>受威胁对象管理</h2>
        <p class="page-desc">维护受威胁对象，围绕对象编号、所属隐患点、对象类型、对象名称做登记、筛选与状态流转。状态单向流转：待登记 → 已登记 → 已转移 → 已解除。</p>
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
      <span class="legend-item">转移核对：{{ stats.ledgerMatchedCount }}/{{ stats.ledgerEntryCount }} 条人数一致</span>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': selectedId === Number(row.id) }">
          <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(Number(row.id))">详情</button>
            <button v-if="String(row.status) === '待登记'" class="link" type="button" @click="doRegister(Number(row.id))">提交登记</button>
            <button v-if="String(row.status) === '已登记'" class="link" type="button" @click="openTransfer(Number(row.id))">确认转移</button>
            <button v-if="String(row.status) === '已转移'" class="link" type="button" @click="doRelease(Number(row.id))">登记解除</button>
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

    <!-- 登记弹窗：同一对象编号重复提交只认第一次 -->
    <div v-if="registerOpen" class="modal-mask" @click.self="registerOpen = false">
      <div class="modal">
        <h3>登记受威胁对象</h3>
        <div class="form-grid">
          <label><span>对象编号</span><input v-model="registerForm.对象编号" placeholder="如 THRE-0006" /></label>
          <label><span>所属隐患点</span><input v-model="registerForm.所属隐患点" /></label>
          <label><span>对象类型</span><input v-model="registerForm.对象类型" placeholder="居民点/学校/通村公路…" /></label>
          <label><span>对象名称</span><input v-model="registerForm.对象名称" /></label>
          <label><span>登记人数</span><input v-model.number="registerForm.登记人数" type="number" min="0" /></label>
          <label><span>最近距离（米）</span><input v-model.number="registerForm.最近距离" type="number" /></label>
          <label><span>联系人</span><input v-model="registerForm.联系人" /></label>
        </div>
        <p class="form-hint">人数口径：居民点、学校等人员聚集对象按人数登记；公路、线路等非人员对象一律按 0 人。最近距离为 0 或 ≥1000 米的极值记录退回核对。</p>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="registerOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitNew">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 转移弹窗：转移结果一次落库并写入避险场所台账 -->
    <div v-if="transferOpen && transferTarget" class="modal-mask" @click.self="transferOpen = false">
      <div class="modal">
        <h3>确认转移：{{ transferTarget['对象编号'] }}</h3>
        <table class="detail-table">
          <tbody>
            <tr><th>对象类型</th><td>{{ transferTarget['对象类型'] }}</td><th>登记人数</th><td>{{ transferTarget['登记人数'] }}</td></tr>
            <tr><th>转移前最近距离</th><td>{{ transferTarget['最近距离'] }} 米</td><th>人数口径</th><td>{{ populatedType ? '人员聚集对象，按实际转移人数' : '非人员对象，按 0 人' }}</td></tr>
          </tbody>
        </table>
        <div class="form-grid">
          <label>
            <span>实际转移人数（现场核对）</span>
            <input v-model.number="transferForm.transferredPeople" type="number" min="0" :disabled="!populatedType" />
          </label>
          <label>
            <span>复测最近距离（米）</span>
            <input v-model.number="transferForm.measuredDistance" type="number" />
          </label>
          <label class="span-2">
            <span>转移去向（避险场所）</span>
            <select v-model.number="transferForm.refugeId">
              <option :value="0" disabled>请选择可启用/已启用的避险场所</option>
              <option v-for="place in refuges" :key="String(place.id)" :value="Number(place.id)">
                {{ place['场所编号'] }} · {{ place['场所名称'] }}（{{ place.status }}，余量 {{ remainingCapacity(place) }} 人）
              </option>
            </select>
          </label>
        </div>
        <p class="form-hint">确认后状态、涉及人数、最近距离与避险场所台账核对项一次落库；复测距离为 0 或 ≥1000 米一律退回核对。</p>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="transferOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitTransfer">确认转移</button>
        </div>
      </div>
    </div>

    <!-- 详情抽屉：与列表对着同一条持久化记录 -->
    <aside v-if="detailOpen && detail" class="drawer">
      <div class="drawer-head">
        <h3>对象详情 · {{ detail['对象编号'] }}</h3>
        <button class="link" type="button" @click="detailOpen = false">关闭</button>
      </div>
      <table class="detail-table">
        <tbody>
          <tr v-for="field in detailFields" :key="field">
            <th>{{ field }}</th>
            <td>{{ formatCell(detail, field) }}</td>
          </tr>
          <tr><th>当前状态</th><td>{{ detail.status }}</td></tr>
          <tr><th>涉及人数（转移口径）</th><td>{{ detail['涉及人数'] }}</td></tr>
        </tbody>
      </table>
      <div class="drawer-actions">
        <button v-if="String(detail.status) === '待登记'" class="btn primary" type="button" @click="detailOpen = false; doRegister(Number(detail.id))">提交登记</button>
        <button v-if="String(detail.status) === '已登记'" class="btn primary" type="button" @click="detailOpen = false; openTransfer(Number(detail.id))">确认转移</button>
        <button v-if="String(detail.status) === '已转移'" class="btn primary" type="button" @click="detailOpen = false; doRelease(Number(detail.id))">登记解除</button>
      </div>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableRefuges,
  confirmRegister,
  confirmTransfer,
  isPopulatedType,
  releaseThreat,
  submitRegister,
  threatDetail,
  threatStats,
} from '@/api/threat-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow, RegisterPayload, ThreatStats, TransferPayload } from '@/data/types'

const meta = moduleMeta('threat')
const columns = ['对象编号', '所属隐患点', '对象类型', '对象名称', '涉及人数', '最近距离', '联系人', '对象状态']
const detailFields = ['对象编号', '所属隐患点', '对象类型', '对象名称', '登记人数', '实际转移人数', '涉及人数', '最近距离', '联系人', '转移去向编号', '转移去向名称', '转移日期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = ref<ThreatStats>({
  registeredCount: 0,
  transferredCount: 0,
  releasedCount: 0,
  affectedPeopleTotal: 0,
  ledgerEntryCount: 0,
  ledgerMatchedCount: 0,
})
const statCards = computed(() => [
  { label: '已登记对象', value: stats.value.registeredCount },
  { label: '已转移对象', value: stats.value.transferredCount },
  { label: '已解除对象', value: stats.value.releasedCount },
  { label: '涉及人数合计（转移口径）', value: stats.value.affectedPeopleTotal },
])
const statusSummary = computed(() =>
  ['待登记', '已登记', '已转移', '已解除'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 抽屉始终按 id 现读持久化记录，刷新、重开页面都与列表是同一条。
const selectedId = ref<number | null>(null)
const detailOpen = ref(false)
const detail = computed<EntryRow | undefined>(() =>
  selectedId.value === null ? undefined : threatDetail(selectedId.value),
)

const registerOpen = ref(false)
const registerForm = reactive<RegisterPayload>({
  对象编号: '',
  所属隐患点: '',
  对象类型: '',
  对象名称: '',
  登记人数: 0,
  最近距离: 0,
  联系人: '',
})

const transferOpen = ref(false)
const transferTargetId = ref<number | null>(null)
const transferTarget = computed<EntryRow | undefined>(() =>
  transferTargetId.value === null ? undefined : threatDetail(transferTargetId.value),
)
const populatedType = computed(() => {
  const target = transferTarget.value
  return target ? isPopulatedType(String(target['对象类型'] ?? '')) : false
})
const refuges = ref<EntryRow[]>([])
const transferForm = reactive<TransferPayload>({ transferredPeople: 0, measuredDistance: 0, refugeId: 0 })
const formError = ref('')

function remainingCapacity(place: EntryRow): number {
  const capacity = Number(place['可容纳人数'] ?? 0)
  const occupied = Number(place['已转入人数'] ?? 0)
  return Math.max(capacity - occupied, 0)
}

function formatCell(row: EntryRow, field: string): string {
  const value = row[field]
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  return field === '最近距离' ? `${value} 米` : String(value)
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
    // 运营概览卡片与详情抽屉共用的同一份统计，刷新也压不住旧值的问题在这里收口。
    stats.value = threatStats()
    if (selectedId.value !== null && !threatDetail(selectedId.value)) {
      selectedId.value = null
      detailOpen.value = false
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '受威胁对象列表读取失败'
  }
}

function openCreate() {
  formError.value = ''
  Object.assign(registerForm, {
    对象编号: '',
    所属隐患点: '',
    对象类型: '',
    对象名称: '',
    登记人数: 0,
    最近距离: 0,
    联系人: '',
  })
  registerOpen.value = true
}

function submitNew() {
  formError.value = ''
  const result = submitRegister({ ...registerForm })
  formError.value = result.ok ? '' : result.message
  if (!result.ok) {
    return
  }
  registerOpen.value = false
  errorMessage.value = result.message
  reload()
}

function doRegister(id: number) {
  const result = confirmRegister(id)
  finishAction(result)
}

function openTransfer(id: number) {
  const target = threatDetail(id)
  if (!target) {
    return
  }
  formError.value = ''
  transferTargetId.value = id
  refuges.value = availableRefuges()
  const typePopulated = isPopulatedType(String(target['对象类型'] ?? ''))
  transferForm.transferredPeople = typePopulated ? Number(target['登记人数'] ?? 0) : 0
  transferForm.measuredDistance = Number(target['最近距离'] ?? 0)
  transferForm.refugeId = refuges.value[0] ? Number(refuges.value[0].id) : 0
  transferOpen.value = true
}

function submitTransfer() {
  if (transferTargetId.value === null) {
    return
  }
  const result = confirmTransfer(transferTargetId.value, {
    transferredPeople: populatedType.value ? Number(transferForm.transferredPeople) : 0,
    measuredDistance: Number(transferForm.measuredDistance),
    refugeId: Number(transferForm.refugeId),
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  transferOpen.value = false
  transferTargetId.value = null
  finishAction(result)
}

function doRelease(id: number) {
  const result = releaseThreat(id)
  finishAction(result)
}

function finishAction(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function openDetail(id: number) {
  selectedId.value = id
  detailOpen.value = true
}

onMounted(reload)
</script>

<style scoped>
.row-selected { background: #eef5ff; }
.modal-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 20;
}
.modal {
  background: #fff; border-radius: 10px; padding: 18px 20px; width: 720px; max-width: 92vw;
  max-height: 86vh; overflow: auto;
}
.modal h3 { margin: 0 0 12px; font-size: 16px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input, .form-grid select {
  width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px;
}
.form-grid .span-2 { grid-column: span 2; }
.form-hint { font-size: 12px; color: var(--muted); margin: 10px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 440px; max-width: 94vw; z-index: 21;
  background: #fff; border-left: 1px solid var(--border); padding: 16px 18px; overflow: auto;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.12);
}
.drawer-head { display: flex; justify-content: space-between; align-items: center; }
.drawer-head h3 { margin: 0; font-size: 15px; }
.detail-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.detail-table th, .detail-table td {
  border: 1px solid var(--border); padding: 6px 8px; font-size: 13px; text-align: left;
}
.detail-table th { width: 42%; color: var(--muted); font-weight: normal; background: #f8fafc; }
.drawer-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
</style>
