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
	export class DiskInfo {
	    filesystem: string;
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

