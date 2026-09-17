<script setup lang="ts">
/**
 * 主机卡片：发行版图标 + 名字 + user@host，在线/掉线底色，已打开绿点。
 * 供「全部主机」页的分组色块与置顶区块共用；事件全部交给父组件处理。
 * 根节点会继承透传属性（如 data-pin-host、额外 class）。
 */
import DistroLogo from "@/components/DistroLogo.vue";
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
  /** 置顶区排序：拖动时插入到本卡片之前，左侧显示插入线 */
  insertBefore?: boolean;
}>();

const emit = defineEmits<{
  (e: "click"): void;
  (e: "dblclick"): void;
  (e: "contextmenu", ev: MouseEvent): void;
  (e: "pointerdown", ev: PointerEvent): void;
  (e: "refresh-icon"): void;
}>();

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
    }"
    :title="cardTip()"
    @pointerdown="emit('pointerdown', $event)"
    @click="emit('click')"
    @dblclick="emit('dblclick')"
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
      <DistroLogo :os-release="osRelease" :size="22" class="host-ico" />
    </span>
    <div class="host-info">
      <div class="host-name">
        {{ host.name }}
        <span
          v-if="running"
          class="run-dot"
          v-tip="'已打开会话（后台保持）'"
        />
        <span v-if="reach === 'no_agent'" class="no-agent-badge">未装</span>
      </div>
      <div class="host-sub">{{ host.user || "?" }}@{{ host.hostName || "?" }}</div>
      <div v-if="showPort()" class="host-port">端口 {{ host.port }}</div>
    </div>
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
  box-shadow: inset 0 0 0 1px var(--m3-outline-variant, #cac4d0);
  transition:
    box-shadow var(--m3-motion-select),
    opacity var(--m3-motion-state),
    background-color 0.2s ease;

  &:hover {
    box-shadow: inset 0 0 0 2px var(--m3-primary);
  }

  &:active {
    cursor: grabbing;
  }

  &.is-inspected {
    box-shadow: inset 0 0 0 2px var(--m3-primary);
    background: color-mix(in srgb, var(--m3-primary) 8%, #fff);
  }

  &.is-drag-source {
    opacity: 0.45;
  }

  /* 置顶区排序：插入到本卡片之前时，左侧竖线提示 */
  &.is-insert-before::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 2px;
    background: var(--m3-primary);
  }

  /* SSH 接不上：整卡红 */
  &.is-ssh-down {
    background: color-mix(in srgb, #d93025 12%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #d93025 45%, transparent);

    &:hover,
    &.is-inspected {
      box-shadow: inset 0 0 0 2px #d93025;
    }
  }

  /* SSH 通但未装 Agent：灰卡 */
  &.is-no-agent {
    background: color-mix(in srgb, #9aa0a6 14%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #9aa0a6 40%, transparent);

    &:hover,
    &.is-inspected {
      box-shadow: inset 0 0 0 2px #80868b;
    }
  }
}

.host-ico-wrap {
  display: flex;
  flex-shrink: 0;
  cursor: context-menu;
}

.host-ico {
  flex-shrink: 0;
}

.host-info {
  min-width: 0;
  flex: 1;
}

.host-name {
  font-size: 14px;
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
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-port {
  margin-top: 2px;
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

/* 仅「已打开」显示绿色小点，不作在线指示 */
.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1e8e3e;
  flex-shrink: 0;
}

.no-agent-badge {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 8px;
  color: #5f6368;
  background: color-mix(in srgb, #9aa0a6 22%, #fff);
}

:global(html.dark) .host-card {
  background: var(--m3-surface-container-low, #1a1a1d);

  &.is-inspected {
    background: color-mix(in srgb, var(--m3-primary) 16%, #1a1a1d);
  }

  &.is-ssh-down {
    background: color-mix(in srgb, #d93025 22%, #1a1a1d);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #d93025 55%, transparent);
  }

  &.is-no-agent {
    background: color-mix(in srgb, #9aa0a6 18%, #1a1a1d);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #9aa0a6 45%, transparent);
  }
}

:global(html.dark) .no-agent-badge {
  color: #dadce0;
  background: color-mix(in srgb, #9aa0a6 28%, #1a1a1d);
}
</style>
