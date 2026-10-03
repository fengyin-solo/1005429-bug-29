<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。受威胁对象的人数按实际转移口径统计，与详情抽屉取自同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">受威胁对象转移口径</h3>
    <div class="stat-row">
      <article v-for="card in threatCards" :key="card.label" class="stat-card" :class="{ 'card-warn': card.warn }">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <p class="recon-line">
      避险场所台账转移核对：{{ threat.ledgerMatchedCount }}/{{ threat.ledgerEntryCount }} 条人数一致
      <span v-if="threat.ledgerMatchedCount !== threat.ledgerEntryCount" class="error-text">（存在人数不符项，请回台账核对）</span>
    </p>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult, ThreatStats } from '@/data/types'

const EMPTY_THREAT: ThreatStats = {
  registeredCount: 0,
  transferredCount: 0,
  releasedCount: 0,
  affectedPeopleTotal: 0,
  ledgerEntryCount: 0,
  ledgerMatchedCount: 0,
}

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const threat = ref<ThreatStats>({ ...EMPTY_THREAT })

const threatCards = computed(() => [
  { label: '已登记对象', value: threat.value.registeredCount, warn: false },
  { label: '已转移对象', value: threat.value.transferredCount, warn: false },
  { label: '已解除对象', value: threat.value.releasedCount, warn: false },
  { label: '涉及人数合计（实际转移口径）', value: threat.value.affectedPeopleTotal, warn: false },
])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  threat.value = payload.threat
}

onMounted(refresh)
</script>

<style scoped>
.section-title { font-size: 14px; margin: 18px 0 8px; }
.card-warn { border-color: #f04438; }
.recon-line { font-size: 12px; color: var(--muted); margin: 0 0 12px; }
</style>
