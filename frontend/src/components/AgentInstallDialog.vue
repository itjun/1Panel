<template>
  <el-dialog
    :model-value="store.visible"
    :title="`安装 Agent — ${store.host}`"
    width="480px"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!store.running"
    :show-close="!store.running"
    class="agent-install-dialog"
    @update:model-value="(v: boolean) => v || store.close()"
  >
    <div class="install-body">
      <el-steps direction="vertical" :space="52">
        <el-step
          v-for="s in store.steps"
          :key="s.key"
          :title="s.label"
          :status="elStatus(s.state)"
        >
          <template v-if="s.key === 'upload' && s.state === 'running'" #description>
            <el-progress
              :percentage="s.percent"
              :stroke-width="6"
              class="upload-progress"
            />
          </template>
        </el-step>
      </el-steps>

      <el-alert
        v-if="store.error"
        :title="store.error"
        type="error"
        :closable="false"
        show-icon
        class="install-result"
      />
      <el-alert
        v-else-if="store.resultText"
        :title="store.resultText"
        type="success"
        :closable="false"
        show-icon
        class="install-result"
      />
    </div>

    <template #footer>
      <span v-if="store.running" class="running-hint">
        正在安装，请稍候…（上传约 10MB，视网络可能需要一两分钟）
      </span>
      <el-button v-else type="primary" @click="store.close()">
        {{ store.error ? "关闭" : "完成" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { InstallStepState } from "@/stores/agentInstall";
import { useAgentInstallStore } from "@/stores/agentInstall";

const store = useAgentInstallStore();

type ElStepStatus = "" | "error" | "success" | "wait" | "process" | "finish";

const EL_STATUS: Record<InstallStepState, ElStepStatus> = {
  pending: "wait",
  running: "process",
  error: "error",
  done: "success",
};

function elStatus(state: InstallStepState): ElStepStatus {
  return EL_STATUS[state];
}
</script>

<style scoped lang="scss">
.install-body {
  min-height: 280px;
  display: flex;
  flex-direction: column;
}

.upload-progress {
  width: 88%;
  margin: 2px 0 4px;
}

.install-result {
  margin-top: 14px;
}

.running-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
