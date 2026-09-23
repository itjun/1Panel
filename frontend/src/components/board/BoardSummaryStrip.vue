<template>
  <section class="board-summary" :class="{ 'is-embedded': embedded }" aria-label="看板运行摘要">
    <div class="board-summary__lead">
      <span class="board-summary__live-dot" aria-hidden="true" />
      <div>
        <span class="board-summary__eyebrow">实时运行概览</span>
        <strong class="board-summary__live">LIVE</strong>
      </div>
    </div>

    <div class="board-summary__items">
      <div class="board-summary__item">
        <span class="board-summary__label">监控主机</span>
        <strong class="board-summary__value">{{ twoDigits(summary.totalHosts) }}</strong>
        <span class="board-summary__detail">{{ summary.onlineHosts }} 台在线</span>
      </div>

      <div class="board-summary__item is-healthy">
        <span class="board-summary__label">正常</span>
        <strong class="board-summary__value">{{ twoDigits(summary.healthyHosts) }}</strong>
        <span class="board-summary__detail">运行稳定</span>
      </div>

      <div class="board-summary__item is-attention">
        <span class="board-summary__label">注意</span>
        <strong class="board-summary__value">{{ twoDigits(summary.attentionHosts) }}</strong>
        <span class="board-summary__detail">数据待确认</span>
      </div>

      <div class="board-summary__item is-critical">
        <span class="board-summary__label">严重</span>
        <strong class="board-summary__value">{{ twoDigits(summary.criticalHosts) }}</strong>
        <span class="board-summary__detail">需要处理</span>
      </div>

      <div class="board-summary__item is-unknown">
        <span class="board-summary__label">待采集</span>
        <strong class="board-summary__value">{{ twoDigits(summary.unknownHosts) }}</strong>
        <span class="board-summary__detail">等待首个样本</span>
      </div>

      <div class="board-summary__item board-summary__item--apps" :class="{
        'is-critical': summary.appCritical > 0,
        'is-attention': summary.appCritical === 0 && summary.appUnknown > 0,
      }">
        <span class="board-summary__label">应用订阅</span>
        <strong v-if="summary.appTargets" class="board-summary__value">
          {{ summary.appHealthy }}/{{ summary.appTargets }}
        </strong>
        <strong v-else class="board-summary__value">—</strong>
        <span class="board-summary__detail">
          <template v-if="summary.appCritical">{{ summary.appCritical }} 项异常</template>
          <template v-else-if="summary.appUnknown">{{ summary.appUnknown }} 项待确认</template>
          <template v-else-if="summary.appTargets">全部正常</template>
          <template v-else>未配置</template>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BoardSummary } from "@/utils/boardModel";

withDefaults(
  defineProps<{
    summary: BoardSummary;
    embedded?: boolean;
  }>(),
  { embedded: false }
);

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
</script>

<style scoped lang="scss">
.board-summary {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  min-width: 0;
  min-height: 78px;
  border-top: 1px solid color-mix(in srgb, #51d5b0 28%, transparent);
  border-bottom: 1px solid rgba(160, 207, 213, 0.15);
  background: rgba(16, 35, 45, 0.72);
}

.board-summary.is-embedded {
  min-height: 68px;
}

.board-summary__lead {
  flex: 0 0 164px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-right: 1px solid rgba(160, 207, 213, 0.13);
}

.board-summary__live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #51d5b0;
  box-shadow: 0 0 0 4px rgba(81, 213, 176, 0.12), 0 0 14px rgba(81, 213, 176, 0.65);
}

.board-summary__eyebrow,
.board-summary__label,
.board-summary__detail {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-summary__eyebrow {
  color: #a8c0c3;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.board-summary__live {
  display: block;
  margin-top: 3px;
  color: #edf7f5;
  font: 700 18px/1 "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.08em;
}

.board-summary__items {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.board-summary__item {
  min-width: 0;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  align-content: center;
  column-gap: 10px;
  padding: 0 16px;
  border-right: 1px solid rgba(160, 207, 213, 0.1);
}

.board-summary__item:last-child {
  border-right: 0;
}

.board-summary__label {
  grid-column: 1 / -1;
  margin-bottom: 4px;
  color: #94afb3;
  font-size: 11px;
  letter-spacing: 0.08em;
}

.board-summary__value {
  min-width: 0;
  color: #edf7f5;
  font: 700 24px/1 "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.board-summary__detail {
  align-self: end;
  min-width: 0;
  padding-bottom: 2px;
  color: #88a3a7;
  font-size: 11px;
}

.board-summary__item.is-healthy .board-summary__value {
  color: #51d5b0;
}

.board-summary__item.is-attention .board-summary__value {
  color: #eab25f;
}

.board-summary__item.is-critical .board-summary__value {
  color: #ff6673;
}

.board-summary__item.is-unknown .board-summary__value {
  color: #b1c1c2;
}

@media (max-width: 1280px) {
  .board-summary__lead {
    flex-basis: 126px;
    padding-inline: 12px;
  }

  .board-summary__item {
    padding-inline: 10px;
  }

  .board-summary__value {
    font-size: 20px;
  }
}

@media (max-width: 900px) {
  .board-summary {
    display: block;
  }

  .board-summary__lead {
    height: 48px;
    border-right: 0;
    border-bottom: 1px solid rgba(160, 207, 213, 0.1);
  }

  .board-summary__items {
    min-height: 68px;
    overflow-x: auto;
    grid-template-columns: repeat(6, minmax(104px, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .board-summary__live-dot {
    box-shadow: 0 0 0 4px rgba(81, 213, 176, 0.12);
  }
}
</style>
