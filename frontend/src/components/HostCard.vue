<script setup lang="ts">
/**
 * 主机卡片：系统图标 + 名字 + user@host。
 * 「已打开」是文字标签，表示本机已有会话，不是在线探测。
 * 供主机首页的分组列表与置顶分组共用；事件全部交给父组件处理。
 * 根节点会继承透传属性（如 data-pin-host、额外 class）。
 * dense：中间密度两行布局（名称 / user@ip，略小于舒适卡）。
 */
import DistroLogo from "@/components/DistroLogo.vue";
import { Edit } from "@element-plus/icons-vue";
import type { sshconfig } from "@/api";
import type { FleetReach } from "@/composables/useFleetStatus";

defineOptions({ name: "HostCard" });

const props = defineProps<{
  host: sshconfig.HostConfig;
  /** 舰队探测结果，未探测时传 null */
  reach: FleetReach | null;
  osRelease: string;
  running: boolean;
  selected: boolean;
  /** 正在被拖动的源卡片，半透明 */
  dragSource?: boolean;
  /** 置顶区 / 分组内排序：拖动时插入到本卡片之前，左侧显示插入线 */
  insertBefore?: boolean;
  /** 分组内排序：拖动时插入到本卡片之后，右侧显示插入线 */
  insertAfter?: boolean;
  /** 紧凑两行布局 */
  dense?: boolean;
  /** 整行长条：图标 + 名称 + user@ip，占满分组一行 */
  strip?: boolean;
}>();

const emit = defineEmits<{
  (e: "click", ev: MouseEvent): void;
  (e: "dblclick", ev: MouseEvent): void;
  (e: "contextmenu", ev: MouseEvent): void;
  (e: "pointerdown", ev: PointerEvent): void;
  (e: "edit"): void;
  (e: "refresh-icon"): void;
}>();

function mouseFromKey(e: KeyboardEvent, type: "click" | "dblclick"): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
  });
}

function onCardKey(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    emit("dblclick", mouseFromKey(e, "dblclick"));
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    emit("click", mouseFromKey(e, "click"));
  }
}

function onCardPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement | null;
  if (el) el.focus();
  emit("pointerdown", e);
}

function cardTip(): string | undefined {
  if (props.reach === "ssh_down") return "SSH 接不上";
  if (props.reach === "no_agent") return "SSH 通，未装或未运行 Agent";
  return undefined;
}

function showPort(): boolean {
  const port = props.host.port;
  return !!port && port !== "22";
}
</script>

<template>
  <div
    class="host-card"
    :class="{
      'is-running': running,
      'is-inspected': selected,
      'is-ssh-down': reach === 'ssh_down',
      'is-no-agent': reach === 'no_agent',
      'is-drag-source': !!dragSource,
      'is-insert-before': !!insertBefore,
      'is-insert-after': !!insertAfter,
      'is-dense': !!dense,
      'is-strip': !!strip,
    }"
    :title="cardTip()"
    tabindex="0"
    aria-keyshortcuts="Enter Space"
    @pointerdown="onCardPointerDown"
    @click="emit('click', $event)"
    @dblclick="emit('dblclick', $event)"
    @keydown="onCardKey"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <span
      class="host-ico-wrap"
      v-tip="
        osRelease ? `${osRelease}（右键重新识别）` : '未识别发行版，右键探测'
      "
      @click.stop
      @contextmenu.prevent.stop="emit('refresh-icon')"
    >
      <DistroLogo
        :os-release="osRelease"
        :size="strip ? 20 : dense ? 16 : 18"
        class="host-ico"
      />
    </span>
    <div class="host-info">
      <div class="host-name">
        {{ host.name }}
        <span v-if="running && !strip" class="opened-tag">已打开</span>
        <span v-if="reach === 'no_agent'" class="no-agent-badge">未装</span>
      </div>
      <div class="host-sub">{{ host.user || "?" }}@{{ host.hostName || "?" }}</div>
      <div v-if="showPort()" class="host-port">端口 {{ host.port }}</div>
    </div>
    <button
      v-if="strip"
      type="button"
      class="host-edit-button"
      aria-label="编辑主机"
      @pointerdown.stop
      @click.stop="emit('edit')"
    >
      <el-icon :size="16"><Edit /></el-icon>
    </button>
  </div>
</template>

<style scoped lang="scss">
.host-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--m3-surface-container-lowest, #fff);
  border: none;
  border-radius: var(--m3-shape-m, 12px);
  box-sizing: border-box;
  cursor: grab;
  outline: none;
  touch-action: none;
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant);
  transition:
    box-shadow var(--m3-motion-select),
    opacity var(--m3-motion-state),
    background-color 0.2s ease;

  &:hover {
    background: color-mix(in srgb, var(--m3-on-surface) 4%, #fff);
    box-shadow: inset 0 0 0 1px var(--m3-outline);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 2px;
  }

  &:active {
    cursor: grabbing;
  }

  &.is-inspected {
    background: var(--m3-nav-active-bg);
    box-shadow: none;
  }

  /* 已选卡片的浅蓝背景已经承担焦点反馈，避免点击后出现四边蓝框 */
  &.is-inspected:focus-visible {
    outline: none;
    outline-offset: 0;
  }

  &.is-drag-source {
    opacity: 0.45;
  }

  /* 分组内排序：插入到本卡片之前（左）或之后（右） */
  &.is-insert-before::before,
  &.is-insert-after::after {
    content: "";
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 2px;
    background: var(--m3-primary);
  }

  &.is-insert-before::before {
    left: -7px;
  }

  &.is-insert-after::after {
    right: -7px;
  }

  /* SSH 接不上：整卡红 */
  &.is-ssh-down {
    background: color-mix(in srgb, var(--m3-error) 12%, var(--m3-card));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m3-error) 45%, transparent);

    &:hover,
    &.is-inspected {
      box-shadow: inset 0 0 0 2px var(--m3-error);
    }
  }

  /* SSH 通但未装 Agent：灰卡 */
  &.is-no-agent {
    background: color-mix(in srgb, var(--m3-status-offline) 14%, var(--m3-card));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m3-status-offline) 40%, transparent);

    &:hover,
    &.is-inspected {
      box-shadow: inset 0 0 0 2px var(--m3-status-offline);
    }
  }

  /*
   * 中间密度：两行信息（主机名 / user@ip），比原卡略矮，
   * 但比「标签式」dense 更易读、与分组色块比例更协调。
   */
  &.is-dense {
    padding: 11px 14px;
    gap: 12px;
    border-radius: var(--m3-shape-m);

    .host-name {
      font: var(--m3-title-small);
    }

    .host-sub {
      margin-top: 2px;
      font: var(--m3-body-small);
    }

    .host-port {
      margin-top: 2px;
      font: var(--m3-label-small);
    }
  }

  &.is-strip {
    width: 100%;
    min-height: 60px;
    padding: 10px 18px;
    gap: 14px;
    border-radius: 0;
    background: transparent;
    box-shadow: none;

    &:hover {
      background: color-mix(in srgb, var(--m3-on-surface) 5%, transparent);
      box-shadow: none;
    }

    &.is-inspected {
      background: var(--m3-nav-active-bg);
      box-shadow: none;
    }

    &.is-insert-before::before,
    &.is-insert-after::after {
      top: auto;
      bottom: auto;
      left: 10px;
      right: 10px;
      width: auto;
      height: 3px;
    }

    &.is-insert-before::before {
      top: -5px;
      left: 10px;
    }

    &.is-insert-after::after {
      bottom: -5px;
      right: 10px;
    }

    .host-ico-wrap {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      align-items: center;
      justify-content: center;
      background: #f4511e;
      box-shadow: none;
      opacity: 1;
    }

    .host-ico {
      fill: #fff;
    }
  }
}

.host-ico-wrap {
  display: flex;
  flex-shrink: 0;
  opacity: 0.72;
  cursor: context-menu;
}

.host-ico {
  flex-shrink: 0;
}

.host-info {
  min-width: 0;
  flex: 1;
}

.host-edit-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--m3-shape-s);
  background: transparent;
  color: var(--m3-on-surface-variant);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--m3-motion-state),
    background-color var(--m3-motion-state),
    color var(--m3-motion-state);

  .host-card:hover &,
  .host-card:focus-within &,
  .host-card.is-inspected & {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover {
    background: color-mix(in srgb, var(--m3-primary) 10%, transparent);
    color: var(--m3-primary);
  }

  &:focus-visible {
    outline: var(--m3-focus-ring);
    outline-offset: 1px;
  }
}

.host-name {
  font: var(--m3-title-small);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.host-sub {
  margin-top: 2px;
  font: var(--m3-body-small);
  color: var(--m3-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-port {
  margin-top: 2px;
  font: var(--m3-label-small);
  color: var(--m3-on-surface-variant);
}

.opened-tag {
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--m3-outline);
  border-radius: var(--m3-shape-full);
  background: var(--m3-surface-container);
  color: var(--m3-on-surface);
  font: var(--m3-label-small);
  font-weight: 600;
  line-height: 16px;
}

.opened-tag--trailing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  margin-left: auto;
  padding: 0 9px 0 8px;
  border-color: color-mix(in srgb, var(--m3-status-online) 38%, transparent);
  background: color-mix(in srgb, var(--m3-status-online) 10%, var(--m3-card, #fff));
  color: var(--m3-status-online);
  line-height: 20px;
}

.opened-tag__dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--m3-status-online);
}

.no-agent-badge {
  flex-shrink: 0;
  font: var(--m3-label-small);
  font-weight: 600;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
  color: var(--m3-on-surface-variant);
  background: color-mix(in srgb, var(--m3-status-offline) 22%, var(--m3-card));
}
</style>
