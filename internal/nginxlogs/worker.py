"""只读、有大小上限的 Nginx 日志导出 worker，通过独立 SSH 会话下发。"""
import contextlib
import fcntl
import hashlib
import json
import os
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
LOG_NAMES = ("access.log", "error.log")
LOCAL_READY = threading.Event()


def emit(phase, **fields):
    print(json.dumps(dict(phase=phase, **fields), ensure_ascii=True), file=sys.stderr, flush=True)


def reserve_bytes(total):
    return max(1024 ** 3, total // 10)


def archive_bound(files):
    # PAX/tar 开销，再加 1% 和 1 MiB，用来覆盖 zstd 原始块和帧的开销。
    # 不按假设的压缩率做预算，重复内容的日志也一样。
    raw = sum(info.st_size + 16384
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


def inventory(root, files):
    if not os.path.isabs(root) or os.path.realpath(root) == "/":
        raise RuntimeError("请选择日志目录的绝对路径，不能选择根目录")
    skipped = 0
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        # 只检查这两个文件名；不遍历目录，也不读取日志内容。
        for name in LOG_NAMES:
            try:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                skipped += 1
                continue
            if not stat.S_ISREG(info.st_mode):
                skipped += 1
                continue
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                current = os.fstat(fd)
                if not stat.S_ISREG(current.st_mode) or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
                    raise RuntimeError("日志发生轮转，请重试")
                if current.st_size > 1024 ** 4:
                    raise RuntimeError("单个日志超过 1 TiB，请先缩小导出范围")
                files.append((name, fd, current))
                fd = None
            finally:
                if fd is not None:
                    os.close(fd)
    finally:
        os.close(directory)
    if not files:
        raise RuntimeError("目录中没有可读取的 access.log 或 error.log 普通文件")
    return skipped


class SnapshotReader:
    def __init__(self, fd, size, directory, progress):
        self.fd, self.left = fd, size
        self.directory, self.progress = directory, progress

    def read(self, size):
        check_space(self.directory, CHUNK * 2)
        check_source_space(self.fd)
        size = min(size, self.left, CHUNK)
        data = os.read(self.fd, size)
        if len(data) != size:
            raise RuntimeError("日志在压缩期间被截断，请重试；原日志未作修改")
        self.left -= len(data)
        self.progress(len(data))
        return data


class CompressorPipe:
    def __init__(self, child, directory):
        self.child, self.directory = child, directory
        self.aborted = False
        os.set_blocking(child.stdin.fileno(), False)

    def check(self):
        check_space(self.directory, CHUNK * 2)

    def write(self, data):
        if self.aborted:
            return len(data)  # 出错或取消后，丢掉 tarfile 收尾时的清理写入。
        pending = memoryview(data)
        while pending:
            self.check()
            if self.child.poll() is not None:
                raise RuntimeError("zstd 压缩进程提前退出，未生成下载文件")
            _, ready, _ = select.select([], [self.child.stdin], [], 0.1)
            if not ready:
                continue
            try:
                pending = pending[os.write(self.child.stdin.fileno(), pending):]
            except BlockingIOError:
                continue
            except BrokenPipeError as error:
                raise RuntimeError("zstd 压缩管道中断，未生成下载文件") from error
        return len(data)


@contextlib.contextmanager
def compressor(output, directory):
    child, reader = None, None
    try:
        child = subprocess.Popen(["zstd", "-q", "-c"],
                                 stdin=subprocess.PIPE, stdout=output, stderr=subprocess.PIPE, bufsize=0)
        diagnostic = bytearray()
        # 诊断信息到上限后仍继续读完，避免失败的压缩进程把管道堵死。
        def drain():
            while True:
                data = child.stderr.read(4096)
                if not data:
                    return
                diagnostic.extend(data[:max(0, 8192 - len(diagnostic))])
        reader = threading.Thread(target=drain, daemon=True)
        reader.start()
        pipe = CompressorPipe(child, directory)
        yield pipe
        child.stdin.close()
        while child.poll() is None:
            pipe.check()
            time.sleep(0.1)
        reader.join(timeout=2)
        if child.returncode != 0:
            raise RuntimeError("zstd 压缩失败：" + diagnostic.decode("utf-8", errors="replace").strip())
    finally:
        if child is not None:
            with contextlib.suppress(OSError):
                child.stdin.close()
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            if reader is not None and reader.ident is not None:
                reader.join(timeout=2)
            child.stderr.close()


@contextlib.contextmanager
def tar_stream(compressed):
    with tarfile.open(fileobj=compressed, mode="w|", bufsize=CHUNK, format=tarfile.PAX_FORMAT) as tar:
        try:
            yield tar
        except BaseException:
            compressed.aborted = True
            raise


def compress(files, directory, progress):
    archive = os.path.join(directory, "nginx-logs.tar.zst")
    # 只有新建的私有压缩包可写。所有日志源描述符都是只读。
    with open(archive, "xb", buffering=CHUNK) as output:
        with compressor(output, directory) as compressed:
            with tar_stream(compressed) as tar:
                tar.copybufsize = CHUNK
                for index, (name, fd, info) in enumerate(files):
                    member = tarfile.TarInfo(name)
                    member.size, member.mtime, member.mode = info.st_size, info.st_mtime, 0o600
                    tar.addfile(member, SnapshotReader(fd, member.size, directory, progress))
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
    # SSH 挂断和心跳 EOF 可能同时到达，清理过程不要被再次打断。
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, signal.SIG_IGN)
    raise RuntimeError("日志下载已取消或连接中断")


def watch_connection():
    # 心跳走 stdin，与 stdout 的二进制传输分开。EOF 或客户端丢失时，
    # 即使正在压缩（此时没有 stdout 可发现断开的管道）也要取消。
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
    fs = subprocess.check_output(["stat", "-f", "-c", "%T", parent], timeout=5).strip()
    if fs in (b"tmpfs", b"ramfs"):
        raise RuntimeError("压缩临时目录位于内存文件系统，请改用磁盘目录")
    check_zstd()


def check_zstd():
    if not shutil.which("zstd"):
        raise RuntimeError("远程主机未安装 zstd，请先安装后重试；不会自动安装或切换压缩格式")


def run(root, parent, lock_parent="/tmp"):
    files, directory, lock = [], None, None
    try:
        check_environment(parent)
        lock = acquire_lock(lock_parent)
        emit("checking")
        skipped = inventory(root, files)
        for _, fd, _ in files:
            check_source_space(fd)
        budget = archive_bound(files)
        usage, reserve = check_space(parent, budget)
        total = sum(info.st_size for _, _, info in files)
        emit("checked", total=total, files=len(files), skipped=skipped,
             available=usage.free, required=budget, reserve=reserve)
        if not LOCAL_READY.wait(timeout=15):
            raise RuntimeError("等待本地磁盘空间检查超时，未开始压缩")
        directory = tempfile.mkdtemp(prefix="1panel-nginx-", dir=parent)
        done, last = 0, None
        def progress(size):
            nonlocal done, last
            done += size
            if last is None or time.monotonic() - last >= 0.25:
                emit("compressing", done=done, total=total)
                last = time.monotonic()
        archive = compress(files, directory, progress)
        files.clear()
        size = os.path.getsize(archive)
        emit("downloading", total=size, done=0)
        digest, done = hashlib.sha256(), 0
        with open(archive, "rb") as source:
            while True:
                check_space(parent)
                data = source.read(CHUNK)
                if not data:
                    break
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
            # 保留锁文件的 inode。删掉锁文件会让正在等待的另一个进程绕过这把锁。
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
