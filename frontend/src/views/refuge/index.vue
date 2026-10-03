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

    <footer class="page-foot">
      <span>共 {{ total }} 条避险场所记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <h3 class="section-title">转移核对台账（避险场所接收记录）</h3>
    <p class="page-desc">受威胁对象确认转移后，转移结果一次落库并在此添记一条核对项；转移人数须与对象详情中的涉及人数一致。</p>
    <table class="data-table ledger-table">
      <thead>
        <tr>
          <th>台账编号</th><th>对象编号</th><th>对象类型</th><th>对象名称</th>
          <th>接收场所</th><th>转移人数</th><th>复测距离</th><th>转移日期</th><th>核对结果</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in ledger" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.对象编号 }}</td>
          <td>{{ item.对象类型 }}</td>
          <td>{{ item.对象名称 }}</td>
          <td>{{ item.场所编号 }} · {{ item.场所名称 }}</td>
          <td>{{ item.转移人数 }}</td>
          <td>{{ item.复测距离 }} 米</td>
          <td>{{ item.转移日期 }}</td>
          <td :class="item.核对结果 === '人数一致' ? 'ok-text' : 'error-text'">{{ item.核对结果 }}</td>
        </tr>
        <tr v-if="!ledger.length">
          <td colspan="9" class="empty-state">暂无转移核对项</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { transferLedger } from '@/api/threat-service'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, TransferLedgerEntry } from '@/data/types'

const meta = moduleMeta('refuge')
const columns = ["场所编号", "场所名称", "可容纳人数", "开放条件", "场所负责人", "联系电话", "启用日期", "场所状态"]
const actions = ["提交核验", "确认启用", "办理关闭"]
const statuses = ["待核验", "可启用", "已启用", "已关闭"]
const stats = [{"label": "可启用场所", "value": 0}, {"label": "已启用场所", "value": 0}, {"label": "可容纳人数合计", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const ledger = ref<TransferLedgerEntry[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledger.value = transferLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '避险场所列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title { font-size: 14px; margin: 20px 0 6px; }
.ledger-table { margin-top: 8px; }
.ok-text { color: #067647; }
</style>
