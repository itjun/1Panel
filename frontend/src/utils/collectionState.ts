/** Keep a failed sample identifiable while polling retries it. */
export function collectionState(query: {
  data?: unknown;
  isError: boolean;
  isFetching: boolean;
  failureCount: number;
  errorUpdatedAt: number;
  dataUpdatedAt: number;
}, connectionUnavailable = false) {
  const hasData = query.data != null;
  const unavailable = query.isError || query.failureCount > 0 ||
    query.errorUpdatedAt > query.dataUpdatedAt || (!hasData && connectionUnavailable);
  return {
    unavailable,
    hasData,
    label: unavailable
      ? query.isFetching ? "采集异常 · 重试中" : "采集异常"
      : hasData ? "采集正常" : "正在采集…",
    sampleLabel: unavailable
      ? hasData ? "最后已知读数" : "暂无有效读数"
      : hasData ? "当前" : "首次采样中…",
  };
}
