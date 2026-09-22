/**
 * 与 internal/certnotify.GroupKey 同一格式。
 * 固定样例：certGroupKey(["a.example", "www.a.example"], "LE", 1700000000)
 * === "a.example,www.a.example|LE|1700000000"
 */
export function certGroupKey(
  domains: string[] | null | undefined,
  issuer: string,
  notAfter: number
): string {
  return `${(domains ?? []).join(",")}|${issuer}|${notAfter}`;
}
