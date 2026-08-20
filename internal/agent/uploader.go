package agent

// Uploader 远程上传组件——预留桩。
//
// 设计（本期不实现，仅保留接口与配置开关）：
//   - 各表 rowid 单调递增，天然可作为上传序列号
//   - upload_state 表记录服务端已 ACK 的游标 acked_seq
//   - 上传时按 id > acked_seq 分批取行，Zstd 压缩后 POST 到监控服务器
//   - 服务端返回新 ACK 序列号后删除已确认的旧行
//   - 失败退避重试；上传永远只是 SQLite 的另一个读端，不影响采集
//
// 启用时机：监控服务器就绪后，在 Config 增加 Uploader 配置段并实现 Run。
type Uploader struct{}

// NewUploader 返回未启用的 Uploader 桩
func NewUploader() *Uploader { return &Uploader{} }
