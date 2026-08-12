/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "@wailsjs/go/main/App" {
  export function CollectDisks(...args: any[]): Promise<any>;
  export function CollectDocker(...args: any[]): Promise<any>;
  export function CollectDatabases(...args: any[]): Promise<any>;
  export function CollectLargestFiles(...args: any[]): Promise<any>;
  export function CollectLog(...args: any[]): Promise<any>;
  export function CollectOverview(...args: any[]): Promise<any>;
  export function CollectProcesses(...args: any[]): Promise<any>;
  export function CollectServices(...args: any[]): Promise<any>;
  export function CollectPackages(...args: any[]): Promise<any>;
  export function CollectCrons(...args: any[]): Promise<any>;
  export function CollectJava(...args: any[]): Promise<any>;
  export function CollectNetwork(...args: any[]): Promise<any>;
  export function AddHost(...args: any[]): Promise<any>;
  export function AssignHost(...args: any[]): Promise<any>;
  export function AuthenticateMacUser(...args: any[]): Promise<any>;
  export function AuthenticateWithSystem(...args: any[]): Promise<any>;
  export function AuthStatus(...args: any[]): Promise<any>;
  export function GetCurrentMacUser(...args: any[]): Promise<any>;
  export function GetHomeDir(...args: any[]): Promise<string>;
  export function LogoutMacUser(...args: any[]): Promise<any>;
  export function CloseTerminal(...args: any[]): Promise<any>;
  export function CopySSHID(...args: any[]): Promise<any>;
  export function DeleteGroup(...args: any[]): Promise<any>;
  export function DeleteHost(...args: any[]): Promise<any>;
  export function DockerAction(...args: any[]): Promise<any>;
  export function KillProcess(...args: any[]): Promise<any>;
  export function ListDir(...args: any[]): Promise<any>;
  export function ListGroups(...args: any[]): Promise<any>;
  export function ListHosts(...args: any[]): Promise<any>;
  export function ListHostsAll(...args: any[]): Promise<any>;
  export function ListGroupOverview(...args: any[]): Promise<any>;
  export function ListOneGroupOverview(...args: any[]): Promise<any>;
  export function OpenTerminal(...args: any[]): Promise<any>;
  export function NormalizeFileToLinux(...args: any[]): Promise<any>;
  export function ReadFilePreview(...args: any[]): Promise<any>;
  export function ReadFileText(...args: any[]): Promise<any>;
  export function RenameGroup(...args: any[]): Promise<any>;
  export function RenameHost(...args: any[]): Promise<any>;
  export function ResizeTerminal(...args: any[]): Promise<any>;
  export function TestConnection(...args: any[]): Promise<any>;
  export function UpdateHost(...args: any[]): Promise<any>;
  export function UploadFile(...args: any[]): Promise<any>;
  export function UpsertGroup(...args: any[]): Promise<any>;
  export function WriteTerminal(...args: any[]): Promise<any>;
}

declare module "@wailsjs/go/models" {
  export namespace filetext {
    export class Preview {
      path: string;
      name: string;
      content: string;
      encoding: string;
      lineEnding: string;
      needsNormalize: boolean;
      size: number;
    }
  }
  export namespace groups {
    export class Group {
      id: string;
      name: string;
      order: number;
      hosts: string[];
    }
  }
  export namespace main {
    export class AddHostInput {
      name: string;
      hostName: string;
      user: string;
      password: string;
    }
    export class UpdateHostInput {
      name: string;
      hostName: string;
      user: string;
      password: string;
    }
    export class CopyIDInput {
      [key: string]: any;
    }
    export class GroupOverview {
      [key: string]: any;
    }
  }
  export namespace monitor {
    export class Overview {
      cpuPercent: number;
      memPercent: number;
      memTotal: number;
      memUsed: number;
      swapPercent: number;
      swapTotal: number;
      swapUsed: number;
      load1: number;
      load5: number;
      load15: number;
      uptime: number;
      kernel: string;
      osRelease: string;
      cpuCount: number;
      cpuModel: string;
      hostname: string;
      arch: string;
      ipAddress: string;
      netRxBytes: number;
      netTxBytes: number;
      diskReadBytes: number;
      diskWriteBytes: number;
      diskIOCount: number;
      net1d?: {
        rxBytes: number;
        txBytes: number;
        spanHours: number;
        complete: boolean;
      };
      net7d?: {
        rxBytes: number;
        txBytes: number;
        spanHours: number;
        complete: boolean;
      };
    }
    export class DiskInfo {
      filesystem: string;
      fsType: string;
      mount: string;
      total: number;
      used: number;
      avail: number;
      percent: number;
    }
    export class DockerInfo {
      available: boolean;
      containers: Container[];
    }
    export class Container {
      id: string;
      name: string;
      image: string;
      status: string;
      state: string;
      ports: string;
    }
    export class LargeFilesResult {
      [key: string]: any;
    }
    export class LogResult {
      content: string;
      source: string;
    }
    export class DatabaseInfo {
      name: string;
      version: string;
      running: boolean;
      port: string;
    }
    export class ProcInfo {
      pid: number;
      ppid: number;
      user: string;
      cpu: number;
      mem: number;
      rss: number;
      elapsed: number;
      cmd: string;
    }
    export class Container {
      id: string;
      name: string;
      image: string;
      status: string;
      state: string;
      ports: string;
    }
  }
  export namespace sshconfig {
    export class HostConfig {
      name: string;
      hostName: string;
      user: string;
      port: string;
      [key: string]: any;
    }
  }
}
