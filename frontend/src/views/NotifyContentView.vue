<template>
  <div class="notify-page">
    <p class="notify-page__lead">
      全局内容策略：对所有主机生效，与「主机订阅」是「与」关系——两边都开才推送。
    </p>

    <section class="ns-block">
      <h2 class="ns-block__title">类型总闸</h2>
      <p class="ns-block__hint">
        关掉某类型后，即使主机已订阅该类型，也不发任何通道。
      </p>
      <div class="ns-list">
        <div
          v-for="item in CONTENT_KINDS"
          :key="item.kind"
          class="ns-row"
        >
          <div class="ns-row__main">
            <span class="ns-row__name">{{ item.name }}</span>
            <span class="ns-row__desc">{{ item.desc }}</span>
          </div>
          <el-switch
            :model-value="settings.isContentKindEnabled(item.kind)"
            @change="
              (v: string | number | boolean) =>
                settings.setContentKindEnabled(item.kind, Boolean(v))
            "
          />
        </div>
      </div>
    </section>

    <section class="ns-block">
      <h2 class="ns-block__title">恢复通知</h2>
      <div class="ns-list">
        <div class="ns-row">
          <div class="ns-row__main">
            <span class="ns-row__name">发送恢复通知</span>
            <span class="ns-row__desc">
              指标回落或探活恢复时再推一条「已恢复」；关闭后只发异常侧
            </span>
          </div>
          <el-switch
            :model-value="settings.notifyRecoverEnabled"
            @change="
              (v: string | number | boolean) =>
                settings.setNotifyRecoverEnabled(Boolean(v))
            "
          />
        </div>
      </div>
    </section>

    <section class="ns-block">
      <h2 class="ns-block__title">正文字段</h2>
      <p class="ns-block__hint">
        勾选写入通知正文的字段。建议至少保留主机名与当前值。
      </p>
      <div class="ns-list">
        <div
          v-for="item in CONTENT_FIELDS"
          :key="item.field"
          class="ns-row"
        >
          <div class="ns-row__main">
            <span class="ns-row__name">{{ item.name }}</span>
            <span class="ns-row__desc">{{ item.desc }}</span>
          </div>
          <el-checkbox
            :model-value="settings.isNotifyContentFieldEnabled(item.field)"
            @change="
              (v: string | number | boolean) =>
                settings.setNotifyContentFieldEnabled(item.field, Boolean(v))
            "
          />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  useSettingsStore,
  type AlertContentKind,
  type NotifyContentField,
} from "@/stores/settings";
import { ALERT_RULES } from "@/utils/alerts";

const settings = useSettingsStore();

const CONTENT_KINDS: {
  kind: AlertContentKind;
  name: string;
  desc: string;
}[] = [
  ...ALERT_RULES.map((r) => ({
    kind: r.kind as AlertContentKind,
    name: r.name,
    desc: r.desc,
  })),
  {
    kind: "app",
    name: "应用探活",
    desc: "进程 / 健康检查 / 入口探活异常与恢复",
  },
];

const CONTENT_FIELDS: {
  field: NotifyContentField;
  name: string;
  desc: string;
}[] = [
  { field: "hostName", name: "主机名", desc: "告警来源主机" },
  { field: "metric", name: "指标", desc: "如 CPU、内存、磁盘、负载" },
  { field: "threshold", name: "阈值", desc: "触发条件阈值" },
  { field: "value", name: "当前值", desc: "触发时的实际读数" },
  { field: "service", name: "服务名", desc: "应用探活对应的服务" },
];
</script>

<style scoped lang="scss">
.notify-page {
  width: 100%;
  max-width: none;
  padding: 12px 16px 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
}
.notify-page__lead {
  margin: 0 0 8px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.5;
}

.ns-block {
  margin-top: 16px;
}
.ns-block__title {
  margin: 0 0 4px;
  font: var(--m3-label-large);
  font-weight: 600;
  color: var(--m3-on-surface);
}
.ns-block__hint {
  margin: 0 0 10px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  line-height: 1.45;
}
.ns-list {
  border: 1px solid var(--m3-outline-variant);
  border-radius: var(--m3-shape-xs);
  overflow: hidden;
  background: var(--m3-surface);
}
.ns-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 14px;
  box-sizing: border-box;
}
.ns-row + .ns-row {
  border-top: 1px solid var(--m3-outline-variant);
}
.ns-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ns-row__name {
  font: var(--m3-body-medium);
  color: var(--m3-on-surface);
}
.ns-row__desc {
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
}
</style>
