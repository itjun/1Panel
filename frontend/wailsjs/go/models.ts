export namespace filetext {
	
	export class Preview {
	    path: string;
	    name: string;
	    content: string;
	    encoding: string;
	    lineEnding: string;
	    needsNormalize: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new Preview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.content = source["content"];
	        this.encoding = source["encoding"];
	        this.lineEnding = source["lineEnding"];
	        this.needsNormalize = source["needsNormalize"];
	        this.size = source["size"];
	    }
	}

}

export namespace groups {
	
	export class Group {
	    id: string;
	    name: string;
	    order: number;
	    hosts: string[];
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.order = source["order"];
	        this.hosts = source["hosts"];
	    }
	}

}

export namespace main {
	
	export class AddHostInput {
	    name: string;
	    hostName: string;
	    user: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new AddHostInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.password = source["password"];
	    }
	}
	export class AuthState {
	    authenticated: boolean;
	    username: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.authenticated = source["authenticated"];
	        this.username = source["username"];
	    }
	}
	export class CopyIDInput {
	    name: string;
	    hostName: string;
	    user: string;
	    port: string;
	    password: string;
	    publicKeyFile: string;
	    identityFile: string;
	
	    static createFrom(source: any = {}) {
	        return new CopyIDInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.port = source["port"];
	        this.password = source["password"];
	        this.publicKeyFile = source["publicKeyFile"];
	        this.identityFile = source["identityFile"];
	    }
	}
	export class HostOverviewSnapshot {
	    name: string;
	    hostName: string;
	    user: string;
	    overview: monitor.Overview;
	    disks: monitor.DiskInfo[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HostOverviewSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.overview = this.convertValues(source["overview"], monitor.Overview);
	        this.disks = this.convertValues(source["disks"], monitor.DiskInfo);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class GroupOverview {
	    groupId: string;
	    groupName: string;
	    hosts: HostOverviewSnapshot[];
	
	    static createFrom(source: any = {}) {
	        return new GroupOverview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groupId = source["groupId"];
	        this.groupName = source["groupName"];
	        this.hosts = this.convertValues(source["hosts"], HostOverviewSnapshot);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LocalTextCheck {
	    path: string;
	    relPath: string;
	    name: string;
	    encoding: string;
	    lineEnding: string;
	    needsNormalize: boolean;
	    content: string;
	    normalized: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new LocalTextCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.relPath = source["relPath"];
	        this.name = source["name"];
	        this.encoding = source["encoding"];
	        this.lineEnding = source["lineEnding"];
	        this.needsNormalize = source["needsNormalize"];
	        this.content = source["content"];
	        this.normalized = source["normalized"];
	        this.size = source["size"];
	    }
	}
	export class MacUserInfo {
	    username: string;
	    fullName: string;
	    homeDir: string;
	
	    static createFrom(source: any = {}) {
	        return new MacUserInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.username = source["username"];
	        this.fullName = source["fullName"];
	        this.homeDir = source["homeDir"];
	    }
	}
	export class UpdateHostInput {
	    name: string;
	    hostName: string;
	    user: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateHostInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.password = source["password"];
	    }
	}
	export class ProbeResult {
	    available: boolean;
	    version: string;
	    latencyMs: number;

	    static createFrom(source: any = {}) {
	        return new ProbeResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.version = source["version"];
	        this.latencyMs = source["latencyMs"];
	    }
	}
	export class HostIcon {
	    host: string;
	    osRelease: string;
	    error?: string;

	    static createFrom(source: any = {}) {
	        return new HostIcon(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.osRelease = source["osRelease"];
	        this.error = source["error"];
	    }
	}

}

export namespace monitor {
	
	export class AptPackage {
	    name: string;
	    version: string;
	    depends: number;
	
	    static createFrom(source: any = {}) {
	        return new AptPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.depends = source["depends"];
	    }
	}
	export class Container {
	    id: string;
	    name: string;
	    image: string;
	    status: string;
	    state: string;
	    ports: string;
	
	    static createFrom(source: any = {}) {
	        return new Container(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.status = source["status"];
	        this.state = source["state"];
	        this.ports = source["ports"];
	    }
	}
	export class ContainerStat {
	    name: string;
	    cpuPercent: number;
	    memUsage: number;
	    memLimit: number;
	    memPercent: number;
	    netIn: number;
	    netOut: number;
	    blockIn: number;
	    blockOut: number;
	
	    static createFrom(source: any = {}) {
	        return new ContainerStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memUsage = source["memUsage"];
	        this.memLimit = source["memLimit"];
	        this.memPercent = source["memPercent"];
	        this.netIn = source["netIn"];
	        this.netOut = source["netOut"];
	        this.blockIn = source["blockIn"];
	        this.blockOut = source["blockOut"];
	    }
	}
	export class Cron {
	    user: string;
	    line: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new Cron(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user = source["user"];
	        this.line = source["line"];
	        this.source = source["source"];
	    }
	}
	export class DatabaseInfo {
	    name: string;
	    version: string;
	    running: boolean;
	    port: string;
	
	    static createFrom(source: any = {}) {
	        return new DatabaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.running = source["running"];
	        this.port = source["port"];
	    }
	}
	export class DiskInfo {
	    filesystem: string;
	    fsType: string;
	    mount: string;
	    total: number;
	    used: number;
	    avail: number;
	    percent: number;
	
	    static createFrom(source: any = {}) {
	        return new DiskInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filesystem = source["filesystem"];
	        this.fsType = source["fsType"];
	        this.mount = source["mount"];
	        this.total = source["total"];
	        this.used = source["used"];
	        this.avail = source["avail"];
	        this.percent = source["percent"];
	    }
	}
	export class DockerInfo {
	    available: boolean;
	    containers: Container[];
	    stats: ContainerStat[];
	
	    static createFrom(source: any = {}) {
	        return new DockerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.containers = this.convertValues(source["containers"], Container);
	        this.stats = this.convertValues(source["stats"], ContainerStat);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    mode: string;
	    modTime: string;
	    owner: string;
	    group: string;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.modTime = source["modTime"];
	        this.owner = source["owner"];
	        this.group = source["group"];
	    }
	}
	export class LargeFile {
	    name: string;
	    dir: string;
	    path: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new LargeFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dir = source["dir"];
	        this.path = source["path"];
	        this.size = source["size"];
	    }
	}
	export class LargeFilesResult {
	    files: LargeFile[];
	    incomplete: boolean;
	    message?: string;
	    elapsedMs: number;
	
	    static createFrom(source: any = {}) {
	        return new LargeFilesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], LargeFile);
	        this.incomplete = source["incomplete"];
	        this.message = source["message"];
	        this.elapsedMs = source["elapsedMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LogResult {
	    content: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new LogResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.content = source["content"];
	        this.source = source["source"];
	    }
	}
	export class NetConnection {
	    proto: string;
	    state: string;
	    localAddr: string;
	    remoteAddr: string;
	    recvQ: number;
	    sendQ: number;
	    pid: number;
	    process: string;
	    slow: boolean;
	    slowReason?: string;
	    rttMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new NetConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.proto = source["proto"];
	        this.state = source["state"];
	        this.localAddr = source["localAddr"];
	        this.remoteAddr = source["remoteAddr"];
	        this.recvQ = source["recvQ"];
	        this.sendQ = source["sendQ"];
	        this.pid = source["pid"];
	        this.process = source["process"];
	        this.slow = source["slow"];
	        this.slowReason = source["slowReason"];
	        this.rttMs = source["rttMs"];
	    }
	}
	export class NetInterface {
	    name: string;
	    state: string;
	    mtu: number;
	    mac: string;
	    ipv4: string[];
	    kind: string;
	    rxBytes: number;
	    txBytes: number;
	    rxPackets: number;
	    txPackets: number;
	
	    static createFrom(source: any = {}) {
	        return new NetInterface(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.state = source["state"];
	        this.mtu = source["mtu"];
	        this.mac = source["mac"];
	        this.ipv4 = source["ipv4"];
	        this.kind = source["kind"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	        this.rxPackets = source["rxPackets"];
	        this.txPackets = source["txPackets"];
	    }
	}
	export class NetWindow {
	    rxBytes: number;
	    txBytes: number;
	    spanHours: number;
	    complete: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NetWindow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	        this.spanHours = source["spanHours"];
	        this.complete = source["complete"];
	    }
	}
	export class NetworkSnapshot {
	    interfaces: NetInterface[];
	    privateIPs: string[];
	    publicIPs: string[];
	    dockerIPs: string[];
	    egressPublicIP: string;
	    egressPublicLoc: string;
	    defaultGateway: string;
	    connections: NetConnection[];
	    slowConnections: NetConnection[];
	    connTotal: number;
	    connEstablished: number;
	    connListen: number;
	    connTimeWait: number;
	
	    static createFrom(source: any = {}) {
	        return new NetworkSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.interfaces = this.convertValues(source["interfaces"], NetInterface);
	        this.privateIPs = source["privateIPs"];
	        this.publicIPs = source["publicIPs"];
	        this.dockerIPs = source["dockerIPs"];
	        this.egressPublicIP = source["egressPublicIP"];
	        this.egressPublicLoc = source["egressPublicLoc"];
	        this.defaultGateway = source["defaultGateway"];
	        this.connections = this.convertValues(source["connections"], NetConnection);
	        this.slowConnections = this.convertValues(source["slowConnections"], NetConnection);
	        this.connTotal = source["connTotal"];
	        this.connEstablished = source["connEstablished"];
	        this.connListen = source["connListen"];
	        this.connTimeWait = source["connTimeWait"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
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
	    net1d: NetWindow;
	    net7d: NetWindow;
	
	    static createFrom(source: any = {}) {
	        return new Overview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cpuPercent = source["cpuPercent"];
	        this.memPercent = source["memPercent"];
	        this.memTotal = source["memTotal"];
	        this.memUsed = source["memUsed"];
	        this.swapPercent = source["swapPercent"];
	        this.swapTotal = source["swapTotal"];
	        this.swapUsed = source["swapUsed"];
	        this.load1 = source["load1"];
	        this.load5 = source["load5"];
	        this.load15 = source["load15"];
	        this.uptime = source["uptime"];
	        this.kernel = source["kernel"];
	        this.osRelease = source["osRelease"];
	        this.cpuCount = source["cpuCount"];
	        this.cpuModel = source["cpuModel"];
	        this.hostname = source["hostname"];
	        this.arch = source["arch"];
	        this.ipAddress = source["ipAddress"];
	        this.netRxBytes = source["netRxBytes"];
	        this.netTxBytes = source["netTxBytes"];
	        this.diskReadBytes = source["diskReadBytes"];
	        this.diskWriteBytes = source["diskWriteBytes"];
	        this.diskIOCount = source["diskIOCount"];
	        this.net1d = this.convertValues(source["net1d"], NetWindow);
	        this.net7d = this.convertValues(source["net7d"], NetWindow);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
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
	
	    static createFrom(source: any = {}) {
	        return new ProcInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.ppid = source["ppid"];
	        this.user = source["user"];
	        this.cpu = source["cpu"];
	        this.mem = source["mem"];
	        this.rss = source["rss"];
	        this.elapsed = source["elapsed"];
	        this.cmd = source["cmd"];
	    }
	}
	export class Service {
	    name: string;
	    load: string;
	    active: string;
	    sub: string;
	
	    static createFrom(source: any = {}) {
	        return new Service(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.load = source["load"];
	        this.active = source["active"];
	        this.sub = source["sub"];
	    }
	}
	export class JavaDetail {
	    pid: number;
	    xms: string;
	    xmx: string;
	    jar: string;
	    gcLog: string;
	    heapDumpPath: string;
	    screen: string;
	    hasGCLogging: boolean;
	    hasExitCode: boolean;
	    port: number;

	    static createFrom(source: any = {}) {
	        return new JavaDetail(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.xms = source["xms"];
	        this.xmx = source["xmx"];
	        this.jar = source["jar"];
	        this.gcLog = source["gcLog"];
	        this.heapDumpPath = source["heapDumpPath"];
	        this.screen = source["screen"];
	        this.hasGCLogging = source["hasGCLogging"];
	        this.hasExitCode = source["hasExitCode"];
	        this.port = source["port"];
	    }
	}

}

export namespace sshconfig {
	
	export class HostConfig {
	    name: string;
	    hostName: string;
	    user: string;
	    port: string;
	    identityFile: string;
	    proxyJump: string;
	    hostKeyAlgos: string;
	
	    static createFrom(source: any = {}) {
	        return new HostConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.port = source["port"];
	        this.identityFile = source["identityFile"];
	        this.proxyJump = source["proxyJump"];
	        this.hostKeyAlgos = source["hostKeyAlgos"];
	    }
	}

}

