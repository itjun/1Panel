import type { ResourceAlertKind } from "@/utils/alerts";
import {
  readSettings,
  type AlertContentKind,
  type NotifyContentField,
} from "@/react/state/settings";

/** 告警轮询在组件外读设置。字段与原来的 Pinia settings store 对齐。 */
export function settingsAccess() {
  const settings = readSettings();
  return {
    ...settings,
    isNotifyContentFieldEnabled(field: NotifyContentField) {
      return settings.notifyContentFields.includes(field);
    },
    isContentKindEnabled(kind: AlertContentKind | string) {
      return settings.alertContentKinds.includes(kind as AlertContentKind);
    },
    isResourceNotifySubscribed(host: string, kind: ResourceAlertKind) {
      return (settings.hostResourceNotifySubs[host] || []).includes(kind);
    },
    listResourceNotifySubs(host: string) {
      return settings.hostResourceNotifySubs[host] || [];
    },
    hostsWithResourceNotifySubs() {
      return Object.keys(settings.hostResourceNotifySubs).filter(
        (host) => (settings.hostResourceNotifySubs[host] || []).length > 0,
      );
    },
    isAppNotifySubscribed(host: string, service: string) {
      return (settings.hostAppNotifySubs[host] || []).includes(service);
    },
    listAppNotifySubs(host: string) {
      return settings.hostAppNotifySubs[host] || [];
    },
    hostsWithAppNotifySubs() {
      return Object.keys(settings.hostAppNotifySubs).filter(
        (host) => (settings.hostAppNotifySubs[host] || []).length > 0,
      );
    },
    isCertNotifySubscribed(host: string) {
      return settings.hostCertNotifySubs[host] === true;
    },
    hostsWithCertNotifySubs() {
      return Object.keys(settings.hostCertNotifySubs).filter(
        (host) => settings.hostCertNotifySubs[host] === true,
      );
    },
    effectiveWecomWebhook() {
      if (!settings.notifyEnabled) return "";
      return settings.wecomWebhook.trim();
    },
  };
}
