<template>
  <el-dialog
    :model-value="store.checkOpen"
    :title="`检查 Agent — ${store.checkHost}`"
    width="480px"
    append-to-body
    @update:model-value="(v: boolean) => v || store.closeCheck()"
  >
    <div v-loading="store.checking">
      <AgentCheckList :report="store.checkReport" :checking="store.checking" />
    </div>
    <template #footer>
      <el-button :disabled="store.checking" @click="store.closeCheck()">
        关闭
      </el-button>
      <el-button
        type="primary"
        :loading="store.checking"
        @click="store.runCheck(store.checkHost)"
      >
        再检查
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import AgentCheckList from "@/components/AgentCheckList.vue";
import { useAgentInstallStore } from "@/stores/agentInstall";

const store = useAgentInstallStore();
</script>
