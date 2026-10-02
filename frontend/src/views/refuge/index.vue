<template>
  <section class="page" data-module="refuge">
    <header class="page-head">
      <div>
        <h2>避险场所管理</h2>
        <p class="page-desc">维护避险场所，围绕场所编号、场所名称、可容纳人数、开放条件做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记避险场所</button>
        <button class="btn" type="button" @click="exportRows">导出避险场所清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无避险场所数据，可先登记避险场所</td>
        </tr>
      </tbody>
    </table>

    <section class="ledger-section">
      <header class="ledger-head">
        <h3>转移核对台账</h3>
        <p class="page-desc">
          受威胁对象确认转移的结果落在这里；每条都添记转移核对项，核对时与对象记录上的实际转移人数比对。
        </p>
        <span class="legend-item" :class="{ 'legend-bad': !summary.reconciled }">
          台账接收 {{ summary.ledgerPeople }} 人 / 对象侧已转移 {{ summary.transferredPeople }} 人：
          {{ summary.reconciled ? '对得上' : '对不上' }}
          （已核对一致 {{ summary.checkedCount }} 条，异常 {{ summary.mismatchCount }} 条）
        </span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in ledgerColumns" :key="column">{{ column }}</th>
            <th>转移核对项</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="String(entry.id)">
            <td v-for="column in ledgerColumns" :key="column">{{ entry[column] ?? '—' }}</td>
            <td>
              {{ entry.转移核对项 }}
              <span v-if="entry.abnormal" class="tag tag-bad">异常</span>
              <p v-if="entry.核对说明" class="cell-note">{{ entry.核对说明 }}</p>
            </td>
            <td class="row-actions">
              <button
                v-if="String(entry.转移核对项) !== '核对一致'"
                class="link"
                type="button"
                @click="runCheck(Number(entry.id))"
              >
                执行转移核对
              </button>
              <span v-else class="cell-note">已完成</span>
            </td>
          </tr>
          <tr v-if="!ledger.length">
            <td :colspan="ledgerColumns.length + 2" class="empty-state">暂无转移台账记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条避险场所记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  checkTransferEntry,
  downloadEntries,
  getThreatSummary,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  transferLedger,
} from '@/api/local-service'
import type { EntryRow, ThreatSummary } from '@/data/types'

const meta = moduleMeta('refuge')
const columns = ['场所编号', '场所名称', '可容纳人数', '开放条件', '场所负责人', '联系电话', '启用日期', '场所状态']
const actions = ['提交核验', '确认启用', '办理关闭']
const statuses = ['待核验', '可启用', '已启用', '已关闭']
const ledgerColumns = [
  '对象编号',
  '对象类型',
  '对象名称',
  '避险场所编号',
  '避险场所名称',
  '转移人数',
  '转移日期',
  '转移核对人',
]

const rows = ref<EntryRow[]>([])
const ledger = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 台账与受威胁对象两侧人数都取自汇总口径，任何时候比对的都是落库后的同一份数据。
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

const stats = computed(() => [
  { label: '可启用场所', value: rows.value.filter((row) => String(row.status) === '可启用').length },
  { label: '已启用场所', value: rows.value.filter((row) => String(row.status) === '已启用').length },
  { label: '可容纳人数合计', value: rows.value.reduce((sum, row) => sum + (Number(row.可容纳人数) || 0), 0) },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '避险场所登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runCheck(id: number) {
  errorMessage.value = ''
  const result = checkTransferEntry(id)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledger.value = transferLedger()
    summary.value = getThreatSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '避险场所列表读取失败'
  }
}

onMounted(reload)
</script>
