<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
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
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
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
    <section class="ledger-section">
      <header class="ledger-head">
        <h3>受威胁对象转移口径</h3>
        <p class="page-desc">
          与受威胁对象详情、避险场所转移台账取同一份汇总：转移后涉及人数按实际转移口径重算，状态以持久化记录为准。
        </p>
      </header>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">已登记对象</span>
          <strong class="stat-value">{{ threat.registeredCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已转移对象</span>
          <strong class="stat-value">{{ threat.transferredCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">涉及人数合计</span>
          <strong class="stat-value">{{ threat.peopleTotal }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">对象侧转移人数</span>
          <strong class="stat-value">{{ threat.transferredPeople }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">台账接收人数</span>
          <strong class="stat-value">{{ threat.ledgerPeople }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-bad': !threat.reconciled }">
          <span class="stat-label">两处比对</span>
          <strong class="stat-value">{{ threat.reconciled ? '一致' : '对不上' }}</strong>
        </article>
      </div>
    </section>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { getThreatSummary, loadOverview } from '@/api/local-service'
import type { OverviewResult, ThreatSummary } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const threat = ref<ThreatSummary>({
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

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  threat.value = getThreatSummary()
}

onMounted(refresh)
</script>
