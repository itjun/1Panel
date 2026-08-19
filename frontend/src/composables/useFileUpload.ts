/**
 * 文件管理页的上传逻辑：
 * 拖拽上传（Wails OnFileDrop）、上传前编码检查、上传进度事件、文件选择器兜底。
 * 从 FilesView.vue 抽出，行为保持不变。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { ElMessage } from "element-plus";
import { api } from "@/api";
import type { LocalTextCheck } from "@/api";
import { Events } from "@wailsio/runtime";
import { registerFileDrop } from "@/utils/fileDrop";

export function useFileUpload(
  host: () => string,
  cwd: Ref<string>,
  reload: () => void
) {
  const dragOver = ref(false);
  let dragCounter = 0;
  let pendingPaths: string[] = []; // 拖入待上传的本地路径（文件/文件夹混合）

  const encodeVisible = ref(false);
  const encodeItems = ref<LocalTextCheck[]>([]);

  const uploading = ref(false);
  const uploadProg = ref({ uploaded: 0, total: 0, current: "" });
  const uploadPercent = computed(() => {
    const t = uploadProg.value.total;
    if (!t) return 0;
    return Math.min(100, Math.round((uploadProg.value.uploaded / t) * 100));
  });

  const fileInputRef = ref<HTMLInputElement | null>(null);

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
  // drop 兜底：无论 Wails OnFileDrop 是否回调，webview 的 drop 触发时先复位遮罩，
  // 避免拖放后 dragCounter 失衡或回调未触发导致遮罩卡死
  function onDropFallback() {
    dragOver.value = false;
    dragCounter = 0;
  }

  // 文件拖放：v3 由后端窗口事件转发为 "file:drop" 自定义事件（payload = 本地绝对路径数组）
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

  function triggerUpload() {
    fileInputRef.value?.click();
  }

  async function onFilePicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    // Wails 桌面端通常需要本地绝对路径；浏览器 file input 只有 blob。
    // 若环境支持 path 属性（Electron/Wails 扩展），则上传。
    let uploaded = 0;
    for (const f of Array.from(files)) {
      const any = f as File & { path?: string };
      if (!any.path) {
        ElMessage.warning("当前环境无法读取本地路径，请使用拖拽上传（桌面端）");
        break;
      }
      try {
        await api.uploadFile(host(), any.path, cwd.value);
        uploaded++;
      } catch (e) {
        ElMessage.error(`上传失败 ${f.name}: ${e}`);
      }
    }
    if (uploaded) {
      ElMessage.success(`已上传 ${uploaded} 个文件`);
      reload();
    }
    input.value = "";
  }

  // v3：拖放经 LIFO 分发器（最活跃视图接收）；进度事件各自订阅
  let offDrop: (() => void) | null = null;
  let offProgress: (() => void) | null = null;
  onMounted(() => {
    offDrop = registerFileDrop(handleFileDrop);
    offProgress = Events.On(
      "upload:progress",
      (ev: { data?: { uploaded: number; total: number; current: string } }) => {
        if (ev?.data) onUploadProgress(ev.data);
      }
    );
  });
  onBeforeUnmount(() => {
    offDrop?.();
    offProgress?.();
  });

  return {
    dragOver,
    encodeVisible,
    encodeItems,
    uploading,
    uploadProg,
    uploadPercent,
    fileInputRef,
    onDragEnter,
    onDragLeave,
    onDropFallback,
    cancelEncode,
    uploadAllRaw,
    uploadWithConvert,
    triggerUpload,
    onFilePicked,
  };
}
