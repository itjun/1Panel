/** IPIP 的归属地格式为「国家 省份 城市  运营商」；仅显示已知城市和运营商。 */
export function formatIpLocation(location?: string): string {
  const parts = location?.trim().split(/\s+/) || [];
  return [parts[2], parts.slice(3).join(" ")]
    .filter(value => value && !["—", "-", "未知", "N/A"].includes(value))
    .join(" ");
}
