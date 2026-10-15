"""Read-only, bounded Nginx log export worker, sent over an isolated SSH session."""
import contextlib
import datetime
import fcntl
import functools
import gzip
import hashlib
import json
import os
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

CHUNK = 256 * 1024
RATE = 2 * 1024 * 1024
MAX_FILES = 512
MAX_ENTRIES = 10000
MAX_LINE = 1024 * 1024
MAX_RANGES = 10000
LOCAL_READY = threading.Event()

ACCESS_TIME = re.compile(rb"\[(\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\]")
ERROR_TIME = re.compile(rb"^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})")
ISO_TIME = re.compile(rb'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))|"(?:time|time_iso8601|timestamp|@timestamp)"\s*:\s*"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))"')
MONTHS = {name: i + 1 for i, name in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def emit(phase, **fields):
    print(json.dumps(dict(phase=phase, **fields), ensure_ascii=True), file=sys.stderr, flush=True)


def reserve_bytes(total):
    return max(1024 ** 3, total // 10)


def selected_size(info, ranges=None):
    return info.st_size if ranges is None else sum(end - start for start, end in ranges)


def archive_bound(files, selections=None):
    # PAX names/headers, tar padding, and worst-case DEFLATE growth; never assume logs compress well.
    raw = sum(selected_size(info, selections[name] if selections is not None else None) + 16384
              for name, _, info in files) + 10240
    return raw + raw // 100 + 1024 * 1024


def check_space(directory, required=0):
    usage = shutil.disk_usage(directory)
    reserve = reserve_bytes(usage.total)
    if usage.free < required + reserve:
        raise RuntimeError("磁盘空间不足：可用 %d MiB，压缩包预算 %d MiB，安全预留 %d MiB" %
                           (usage.free // 2**20, required // 2**20, reserve // 2**20))
    return usage, reserve


def check_source_space(fd):
    usage = os.fstatvfs(fd)
    free = usage.f_bavail * usage.f_frsize
    reserve = reserve_bytes(usage.f_blocks * usage.f_frsize)
    if free < reserve:
        raise RuntimeError("日志所在磁盘空间不足，停止导出以便及时释放轮转文件")


class Pacer:
    def __init__(self):
        self.wall, self.cpu = time.monotonic(), time.process_time()

    def step(self, size=0):
        now, cpu = time.monotonic(), time.process_time()
        # Low priority alone is not a limit: also cap throughput and average CPU duty to 20% of one core.
        delay = max(size / RATE, (cpu - self.cpu) / 0.20) - (now - self.wall)
        if delay > 0:
            time.sleep(delay)
        self.wall, self.cpu = time.monotonic(), time.process_time()


def inventory(root, files, pacer, text_only=False):
    if not os.path.isabs(root) or os.path.realpath(root) == "/":
        raise RuntimeError("请选择日志目录的绝对路径，不能选择根目录")
    skipped, entries = 0, 0
    def failed(error):
        raise error
    # fwalk + dir_fd + O_NOFOLLOW prevent symlink substitutions from reading devices or unrelated files.
    for base, dirs, names, directory in os.fwalk(root, follow_symlinks=False, onerror=failed):
        rel = os.path.relpath(base, root)
        if rel.count(os.sep) > 16:
            raise RuntimeError("日志目录层级过深，请选择更具体的目录")
        entries += len(dirs) + len(names)
        if entries > MAX_ENTRIES:
            raise RuntimeError("目录条目过多，请选择更具体的日志目录")
        for name in names:
            if text_only and name.lower().endswith((".gz", ".bz2", ".xz", ".zip", ".zst", ".z", ".tar")):
                skipped += 1
                continue
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                skipped += 1
                continue
            if len(files) >= MAX_FILES:
                raise RuntimeError("日志文件超过 512 个，请选择更具体的目录")
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                current = os.fstat(fd)
                if not stat.S_ISREG(current.st_mode) or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                    raise RuntimeError("日志发生轮转，请重试")
                if current.st_size > 1024 ** 4:
                    raise RuntimeError("单个日志超过 1 TiB，请先缩小导出范围")
                archive_name = os.path.relpath(os.path.join(base, name), root)
                files.append((archive_name, fd, current))
                fd = None
            finally:
                if fd is not None:
                    os.close(fd)
            pacer.step()
    if not files:
        raise RuntimeError("日志目录中没有可读取的普通文件（符号链接和设备文件不导出）")
    return skipped


def day_window(day=None):
    # Both boundaries use the remote host's timezone, including DST transitions.
    day = day or datetime.date.today()
    following = day + datetime.timedelta(days=1)
    start = time.mktime(day.timetuple())
    end = time.mktime(following.timetuple())
    return day.isoformat(), start, end


@functools.lru_cache(maxsize=256)
def parse_timestamp(kind, raw):
    text = raw.decode("ascii")
    try:
        if kind == "access":
            offset = (int(text[22:24]) * 60 + int(text[24:26])) * (1 if text[21] == "+" else -1)
            zone = datetime.timezone(datetime.timedelta(minutes=offset))
            return datetime.datetime(int(text[7:11]), MONTHS[text[3:6]], int(text[:2]),
                                     int(text[12:14]), int(text[15:17]), int(text[18:20]), tzinfo=zone).timestamp()
        if kind == "error":
            return time.mktime(time.strptime(text, "%Y/%m/%d %H:%M:%S"))
        return datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except (ValueError, KeyError, OverflowError):
        return None


def line_timestamp(line):
    match = ERROR_TIME.match(line)
    if match:
        return parse_timestamp("error", match[1])
    match = ACCESS_TIME.search(line)
    if match:
        return parse_timestamp("access", match[1])
    match = ISO_TIME.search(line)
    if match:
        return parse_timestamp("iso", match[1] or match[2])
    return None


def snapshot_lines(fd, size, directory, pacer, progress):
    pending, offset, left = b"", 0, size
    while left:
        check_space(directory, CHUNK * 2)
        check_source_space(fd)
        amount = min(CHUNK, left)
        data = os.read(fd, amount)
        if len(data) != amount:
            raise RuntimeError("日志在筛选期间被截断，请重试；原日志未作修改")
        left -= amount
        pacer.step(amount)
        progress(amount)
        lines = (pending + data).split(b"\n")
        pending = lines.pop()
        for line in lines:
            if len(line) > MAX_LINE:
                raise RuntimeError("单行日志超过 1 MiB，无法安全筛选当日日志")
            line += b"\n"
            yield offset, line
            offset += len(line)
        if len(pending) > MAX_LINE:
            raise RuntimeError("单行日志超过 1 MiB，无法安全筛选当日日志")
    if pending:
        yield offset, pending


def select_today(files, directory, pacer, window, progress):
    selections, unmatched, excluded, fragments = {}, 0, 0, 0
    _, start, end = window
    for index, (name, fd, info) in enumerate(files):
        ranges = []
        for offset, line in snapshot_lines(fd, info.st_size, directory, pacer, progress):
            stamp = line_timestamp(line)
            if stamp is None:
                unmatched += 1
                continue
            if not start <= stamp < end:
                continue
            stop = offset + len(line)
            if ranges and ranges[-1][1] == offset:
                ranges[-1] = (ranges[-1][0], stop)
            else:
                fragments += 1
                if fragments > MAX_RANGES:
                    raise RuntimeError("当日日志片段过多，请选择更具体的日志目录")
                ranges.append((offset, stop))
        if os.fstat(fd).st_size < info.st_size:
            raise RuntimeError("日志在筛选期间被截断，请重试")
        if ranges:
            selections[name] = ranges
        else:
            os.close(fd)
            files[index] = (name, None, info)
            excluded += 1
    files[:] = [entry for entry in files if entry[1] is not None]
    if not files:
        raise RuntimeError("没有找到 %s 的日志记录（按远程主机日期，支持 Nginx 标准时间及 ISO 8601 时间）" % window[0])
    return selections, unmatched, excluded


class SnapshotReader:
    def __init__(self, fd, size, directory, pacer, progress, ranges=None):
        self.fd, self.left = fd, size
        self.directory, self.pacer, self.progress = directory, pacer, progress
        self.ranges = iter(ranges if ranges is not None else [(0, size)])
        self.range_left = 0

    def read(self, size):
        check_space(self.directory, CHUNK * 2)
        check_source_space(self.fd)
        size = min(size, self.left, CHUNK)
        parts, remaining = [], size
        while remaining:
            if not self.range_left:
                start, end = next(self.ranges)
                os.lseek(self.fd, start, os.SEEK_SET)
                self.range_left = end - start
            amount = min(remaining, self.range_left)
            data = os.read(self.fd, amount)
            if len(data) != amount:
                raise RuntimeError("日志在压缩期间被截断，请重试；原日志未作修改")
            parts.append(data)
            self.range_left -= amount
            remaining -= amount
        data = b"".join(parts)
        self.left -= len(data)
        self.pacer.step(len(data))
        self.progress(len(data))
        return data


def compress(files, directory, progress, pacer, selections=None):
    archive = os.path.join(directory, "nginx-logs.tar.gz")
    # Only the new private archive is writable. Every source descriptor is read-only.
    with open(archive, "xb", buffering=CHUNK) as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=1, mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode="w|", bufsize=CHUNK, format=tarfile.PAX_FORMAT) as tar:
                tar.copybufsize = CHUNK
                for index, (name, fd, info) in enumerate(files):
                    member = tarfile.TarInfo(name)
                    ranges = selections[name] if selections is not None else None
                    member.size, member.mtime, member.mode = selected_size(info, ranges), info.st_mtime, 0o600
                    tar.addfile(member, SnapshotReader(fd, member.size, directory, pacer, progress, ranges))
                    if os.fstat(fd).st_size < info.st_size:
                        raise RuntimeError("日志在压缩期间被截断，请重试")
                    os.close(fd)
                    files[index] = (name, None, info)
                check_space(directory, CHUNK * 2)
    return archive


def acquire_lock(parent):
    name = os.path.join(parent, ".1panel-nginx-export-%d.lock" % os.getuid())
    fd = os.open(name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise RuntimeError("日志导出锁不安全，已停止")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("此主机当前用户已有日志下载任务，请稍后重试")
        return fd
    except BaseException:
        os.close(fd)
        raise


def stop(signum, frame):
    # Do not interrupt cleanup if SSH hangup and heartbeat EOF arrive together.
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, signal.SIG_IGN)
    raise RuntimeError("日志下载已取消或连接中断")


def watch_connection():
    # Heartbeat is on stdin, independent of the binary stdout transfer. EOF or a lost client
    # cancels even while compressing (when there is no stdout to detect a broken pipe).
    while True:
        ready, _, _ = select.select([sys.stdin.buffer], [], [], 15)
        data = os.read(sys.stdin.fileno(), 64) if ready else b""
        if not data:
            os.kill(os.getpid(), signal.SIGTERM)
            return
        if b"A" in data:
            LOCAL_READY.set()


def check_environment(parent):
    if sys.platform != "linux":
        raise RuntimeError("日志压缩下载仅支持 Linux 远程主机")
    if os.getpriority(os.PRIO_PROCESS, 0) != 19:
        raise RuntimeError("无法设置最低 CPU 优先级，已停止")
    priority = subprocess.check_output(["ionice", "-p", str(os.getpid())], env=dict(os.environ, LC_ALL="C"), timeout=5)
    if not priority.startswith(b"idle"):
        raise RuntimeError("无法设置空闲磁盘 I/O 优先级，已停止")
    fs = subprocess.check_output(["stat", "-f", "-c", "%T", parent], timeout=5).strip()
    if fs in (b"tmpfs", b"ramfs"):
        raise RuntimeError("压缩临时目录位于内存文件系统，请改用磁盘目录")


def run(root, parent, lock_parent="/tmp"):
    files, directory, lock = [], None, None
    try:
        check_environment(parent)
        lock = acquire_lock(lock_parent)
        window = day_window()  # Pin the target day once, even if the export crosses midnight.
        emit("checking", date=window[0])
        pacer = Pacer()
        skipped = inventory(root, files, pacer, text_only=True)
        for _, fd, _ in files:
            check_source_space(fd)
        check_space(parent)
        scanned, last_scan = 0, 0
        scan_total = sum(info.st_size for _, _, info in files)
        def scanning(size):
            nonlocal scanned, last_scan
            scanned += size
            if time.monotonic() - last_scan >= 0.25:
                emit("filtering", date=window[0], done=scanned, total=scan_total)
                last_scan = time.monotonic()
        selections, unmatched, excluded = select_today(files, parent, pacer, window, scanning)
        budget = archive_bound(files, selections)
        usage, reserve = check_space(parent, budget)
        total = sum(selected_size(info, selections[name]) for name, _, info in files)
        emit("checked", date=window[0], total=total, files=len(files), skipped=skipped + excluded, unmatched=unmatched,
             available=usage.free, required=budget, reserve=reserve)
        if not LOCAL_READY.wait(timeout=15):
            raise RuntimeError("等待本地磁盘空间检查超时，未开始压缩")
        directory = tempfile.mkdtemp(prefix="1panel-nginx-", dir=parent)
        done, last = 0, 0
        def progress(size):
            nonlocal done, last
            done += size
            if time.monotonic() - last >= 0.25:
                emit("compressing", done=done, total=total)
                last = time.monotonic()
        archive = compress(files, directory, progress, pacer, selections)
        files.clear()
        size = os.path.getsize(archive)
        emit("downloading", total=size, done=0)
        digest, done = hashlib.sha256(), 0
        pacer = Pacer()
        with open(archive, "rb") as source:
            while True:
                check_space(parent)
                data = source.read(CHUNK)
                if not data:
                    break
                pacer.step(len(data))
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
                digest.update(data)
                done += len(data)
                emit("downloading", total=size, done=done)
        emit("complete", total=size, done=done, sha256=digest.hexdigest())
    finally:
        for _, fd, _ in files:
            if fd is not None:
                with contextlib.suppress(OSError):
                    os.close(fd)
        if directory:
            shutil.rmtree(directory)
        if lock is not None:
            # Keep the lock inode: unlinking lets another process bypass an existing waiter.
            os.close(lock)


if __name__ == "__main__":
    os.umask(0o077)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop)
    threading.Thread(target=watch_connection, daemon=True).start()
    try:
        run(sys.argv[1], sys.argv[2])
    except Exception as error:
        try:
            emit("error", message=str(error))
        finally:
            sys.exit(1)
