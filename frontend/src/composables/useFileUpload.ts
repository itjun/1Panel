/**
 * 文件管理页的上传逻辑：
 * 拖拽上传（Wails WindowFilesDropped → file:drop）、上传前编码检查、
 * 上传进度事件、系统文件对话框选择上传。
 * 从 FilesView.vue 抽出，行为保持不变。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { Dialogs, Events } from "@wailsio/runtime";
import { api } from "@/api";
import type { LocalTextCheck } from "@/api";
import { registerFileDrop } from "@/utils/fileDrop";
import { useAppStore } from "@/stores/app";

export function useFileUpload(
  host: () => string,
  cwd: Ref<string>,
  reload: () => void
) {
  const app = useAppStore();
  const dragOver = ref(false);
  let dragCounter = 0;
  let pendingPaths: string[] = []; // 拖入 / 对话框选出的本地路径（文件/文件夹混合）

  const encodeVisible = ref(false);
  const encodeItems = ref<LocalTextCheck[]>([]);

  const uploading = ref(false);
  const uploadProg = ref({ uploaded: 0, total: 0, current: "" });
  const uploadPercent = computed(() => {
    const t = uploadProg.value.total;
    if (!t) return 0;
    return Math.min(100, Math.round((uploadProg.value.uploaded / t) * 100));
  });

  function onDragEnter() {
    dragCounter++;
    dragOver.value = true;
  }
  function onDragLeave() {
    dragCounter--;
    if (dragCounter <= 0) {
      dragOver.value = false;
      dragCounter = 0;
    }
  }
  // drop 兜底：无论 Wails 是否回调，webview 的 drop 触发时先复位遮罩，
  // 避免拖放后 dragCounter 失衡或回调未触发导致遮罩卡死
  function onDropFallback() {
    dragOver.value = false;
    dragCounter = 0;
  }

  // 文件拖放：v3 由后端窗口事件转发为 "file:drop"（payload = 本地绝对路径数组）
  // 前提：放置目标元素带 data-file-drop-target（见 FilesView 根节点）
  function handleFileDrop(paths: string[]) {
    dragOver.value = false;
    dragCounter = 0;
    if (!paths?.length) return;
    pendingPaths = paths;
    void startEncodeCheck(paths);
  }

  async function startEncodeCheck(paths: string[]) {
    try {
      const items = await api.checkLocalPaths(paths);
      if (items.length > 0) {
        encodeItems.value = items;
        encodeVisible.value = true;
      } else {
        await doUpload([]); // 无非标准文件，直接上传
      }
    } catch (e) {
      ElMessage.error(`编码检测失败: ${e}`);
      await doUpload([]); // 检测失败仍允许原样上传
    }
  }

  function cancelEncode() {
    encodeVisible.value = false;
    pendingPaths = [];
  }
  function uploadAllRaw() {
    encodeVisible.value = false;
    void doUpload([]);
  }
  function uploadWithConvert(convertPaths: string[]) {
    encodeVisible.value = false;
    void doUpload(convertPaths);
  }

  async function doUpload(convertPaths: string[]) {
    if (!pendingPaths.length) return;
    uploading.value = true;
    uploadProg.value = { uploaded: 0, total: 0, current: "" };
    try {
      await api.uploadPaths(host(), pendingPaths, convertPaths, cwd.value);
      ElMessage.success("上传完成");
      reload();
    } catch (e) {
      ElMessage.error(`上传失败: ${e}`);
    } finally {
      uploading.value = false;
      pendingPaths = [];
    }
  }

  function onUploadProgress(payload: {
    uploaded: number;
    total: number;
    current: string;
  }) {
    uploadProg.value = {
      uploaded: payload.uploaded || 0,
      total: payload.total || 0,
      current: payload.current || "",
    };
  }

  /** 系统文件对话框选路径（可多选、可选文件夹），再走与拖拽相同的编码检查/上传 */
  async function triggerUpload() {
    try {
      const result = await Dialogs.OpenFile({
        Title: "选择要上传的文件或文件夹",
        AllowsMultipleSelection: true,
        CanChooseFiles: true,
        CanChooseDirectories: true,
      });
      const paths = Array.isArray(result)
        ? result.filter(Boolean)
        : result
          ? [result]
          : [];
      if (!paths.length) return;
      pendingPaths = paths;
      void startEncodeCheck(paths);
    } catch (e) {
      ElMessage.error(`选择文件失败: ${e}`);
    }
  }

  // 仅当前主机旧版「文件」子页可见时入栈，避免多主机常驻 FilesView 抢拖放
  let offDrop: (() => void) | null = null;
  let offProgress: (() => void) | null = null;

  watch(
    () => app.isHostSubActive(host(), "file-manager"),
    (active) => {
      if (active) {
        if (!offDrop) offDrop = registerFileDrop(handleFileDrop);
      } else {
        offDrop?.();
        offDrop = null;
        dragOver.value = false;
        dragCounter = 0;
      }
    },
    { immediate: true }
  );

  onMounted(() => {
    offProgress = Events.On(
      "upload:progress",
      (ev: { data?: { uploaded: number; total: number; current: string } }) => {
        if (ev?.data) onUploadProgress(ev.data);
      }
    );
  });
  onBeforeUnmount(() => {
    offDrop?.();
    offDrop = null;
    offProgress?.();
  });

  return {
    dragOver,
    encodeVisible,
    encodeItems,
    uploading,
    uploadProg,
    uploadPercent,
    onDragEnter,
    onDragLeave,
    onDropFallback,
    cancelEncode,
    uploadAllRaw,
    uploadWithConvert,
    triggerUpload,
  };
}
