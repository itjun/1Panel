package main

// 启动不再预热全部主机。
// SSH / agent 完全惰性：第一次真正用到某台才建连。
// 以前这里会并发 Status() 扫 sshconfig 全集，冷启动就会对所有主机探活。
