import contextlib
import hashlib
import io
import itertools
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

import worker

Usage = type(shutil.disk_usage("/"))
ENOUGH = Usage(20 * 1024**3, 1 * 1024**3, 19 * 1024**3)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "logs"
        self.root.mkdir()
        self.archive_dir = Path(self.temp.name) / "archives"
        self.archive_dir.mkdir()
        self.files = []
        self.addCleanup(self.close_files)
        worker.LOCAL_READY.set()

    def close_files(self):
        for _, fd, _ in self.files:
            if fd is not None:
                os.close(fd)
        self.files.clear()

    def scan(self):
        return worker.inventory(str(self.root), self.files)

    def today_line(self):
        return (time.strftime("%Y/%m/%d %H:%M:%S") + " [info] current request\n").encode()

    def compress(self):
        with patch.object(worker.shutil, "disk_usage", return_value=ENOUGH):
            archive = worker.compress(self.files, str(self.archive_dir), lambda n: None)
        with tarfile.open(fileobj=io.BytesIO(subprocess.check_output(["zstd", "-d", "-c", archive]))) as package:
            return {name: package.extractfile(name).read() for name in package.getnames()}

    def test_append_is_bounded_and_rotation_keeps_original_inode(self):
        log = self.root / "access.log"
        log.write_bytes(b"before\n")
        original_inode = log.stat().st_ino
        self.scan()
        with log.open("ab") as output:
            output.write(b"new requests\n")
        log.rename(self.root / "access.log.1")
        log.write_bytes(b"new active log\n")
        self.assertEqual(self.compress(), {"access.log": b"before\n"})
        self.assertEqual(log.read_bytes(), b"new active log\n")
        self.assertEqual((self.root / "access.log.1").stat().st_ino, original_inode)
        self.assertEqual((self.root / "access.log.1").read_bytes(), b"before\nnew requests\n")

    def test_symlinks_fifo_and_symlink_directories_are_not_followed(self):
        (self.root / "error.log").write_bytes(b"error")
        os.symlink("/dev/zero", self.root / "access.log")
        os.mkfifo(self.root / "fifo")
        os.symlink(self.archive_dir, self.root / "linked")
        (self.archive_dir / "secret").write_bytes(b"secret")
        self.assertEqual(self.scan(), 1)
        self.assertEqual(self.compress(), {"error.log": b"error"})

    def test_spaces_quotes_unicode_in_directory(self):
        child = self.root / "访问 ' $(touch nope)"
        child.mkdir()
        self.root = child
        (self.root / "access.log").write_bytes(b"log")
        self.scan()
        self.assertEqual(self.compress(), {"access.log": b"log"})

    def test_truncation_fails_instead_of_publishing_incomplete_log(self):
        log = self.root / "access.log"
        log.write_bytes(b"requests" * 100)
        self.scan()
        log.write_bytes(b"short")
        with self.assertRaisesRegex(RuntimeError, "截断"):
            self.compress()
        self.assertEqual(log.read_bytes(), b"short")

    def test_space_check_includes_reserve_and_incompressible_bound(self):
        (self.root / "access.log").write_bytes(os.urandom(131072))
        self.scan()
        bound = worker.archive_bound(self.files)
        self.compress()
        self.assertGreater(bound, (self.archive_dir / "nginx-logs.tar.zst").stat().st_size)
        with patch.object(worker.shutil, "disk_usage", return_value=Usage(20 << 30, 0, (2 << 30) + bound - 1)):
            with self.assertRaisesRegex(RuntimeError, "磁盘空间不足"):
                worker.check_space(str(self.archive_dir), bound)
        self.assertEqual(worker.reserve_bytes(1 << 30), 1 << 30)

    def test_disk_drop_mid_compression_stops_reading(self):
        (self.root / "access.log").write_bytes(b"a" * (worker.CHUNK * 2))
        self.scan()
        with patch.object(worker.shutil, "disk_usage", side_effect=itertools.chain([ENOUGH], itertools.repeat(Usage(20 << 30, 0, 1)))):
            with self.assertRaisesRegex(RuntimeError, "磁盘空间不足"):
                worker.compress(self.files, str(self.archive_dir), lambda n: None)
        self.assertLessEqual(os.lseek(self.files[0][1], 0, os.SEEK_CUR), worker.CHUNK)

    def test_missing_and_empty_logs(self):
        with self.assertRaisesRegex(RuntimeError, "没有"):
            self.scan()
        (self.root / "access.log").touch()
        (self.root / "error.log").touch()
        self.assertEqual(self.scan(), 0)
        self.assertEqual(self.compress(), {"access.log": b"", "error.log": b""})

    def test_lock_excludes_concurrent_jobs_and_releases_after_close(self):
        fd = worker.acquire_lock(str(self.archive_dir))
        try:
            with self.assertRaisesRegex(RuntimeError, "已有"):
                worker.acquire_lock(str(self.archive_dir))
        finally:
            os.close(fd)
        os.close(worker.acquire_lock(str(self.archive_dir)))

    def test_source_disk_pressure_aborts_and_closes_snapshots(self):
        from types import SimpleNamespace
        (self.root / "access.log").write_bytes(b"requests")
        self.scan()
        with patch.object(worker.os, "fstatvfs", return_value=SimpleNamespace(f_bavail=1, f_frsize=4096, f_blocks=1000000)):
            with self.assertRaisesRegex(RuntimeError, "日志所在磁盘空间不足"):
                self.compress()

    def test_success_releases_rotated_file_descriptors_immediately(self):
        (self.root / "access.log").write_bytes(b"requests")
        self.scan()
        fd = self.files[0][1]
        self.compress()
        with self.assertRaises(OSError):
            os.fstat(fd)

    def test_run_cleans_up_when_compression_fails(self):
        (self.root / "access.log").write_bytes(self.today_line())
        with patch.object(worker, "check_environment"), patch.object(worker.shutil, "disk_usage", return_value=ENOUGH), patch.object(worker, "compress", side_effect=RuntimeError("test failure")), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "test failure"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))
        os.close(worker.acquire_lock(str(self.archive_dir)))

    def test_local_preflight_must_acknowledge_before_compression(self):
        (self.root / "access.log").write_bytes(self.today_line())
        with patch.object(worker, "check_environment"), patch.object(worker.shutil, "disk_usage", return_value=ENOUGH), patch.object(worker.LOCAL_READY, "wait", return_value=False), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "未开始压缩"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))

    def test_memory_filesystem_is_rejected(self):
        with patch.object(worker.sys, "platform", "linux"), patch.object(worker.subprocess, "check_output", return_value=b"tmpfs"):
            with self.assertRaisesRegex(RuntimeError, "内存文件系统"):
                worker.check_environment(str(self.archive_dir))

    def test_heartbeat_eof_terminates_worker_and_cleans_archive(self):
        (self.root / "access.log").write_bytes(self.today_line() * 8192)
        # 在 macOS 上也走真实入口、心跳、信号和清理；
        # Linux 文件系统探测在 macOS 上被替换掉。
        code = Path(worker.__file__).read_text().replace('lock_parent="/tmp"', "lock_parent=" + repr(str(self.archive_dir))).replace('        check_environment(parent)', '        pass # 平台探测在 Linux 上测')
        child_pid = Path(self.temp.name) / "compressor.pid"
        code = code.replace("        diagnostic = bytearray()", "        open(" + repr(str(child_pid)) + ", 'w').write(str(child.pid))\n        diagnostic = bytearray()")
        # 在第一条进度之后暂停，这样即使很小、没有限速的夹具
        # 也会停在压缩阶段，直到测试关掉心跳管道。
        code = code.replace('emit("compressing", done=done, total=total)', 'emit("compressing", done=done, total=total)\n                time.sleep(1)')
        compile(code, "worker-test", "exec")
        process = subprocess.Popen([sys.executable, "-u", "-c", code, str(self.root), str(self.archive_dir)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        def cleanup():
            with contextlib.suppress(OSError):
                process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()
        self.addCleanup(cleanup)
        process.stdin.write(b".A")
        process.stdin.flush()
        events = []
        while True:
            line = process.stderr.readline()
            self.assertTrue(line, "worker exited before compression: %s" % events)
            events.append(line.decode())
            if json.loads(line)["phase"] == "compressing":
                break
        process.stdin.close()
        self.assertNotEqual(process.wait(timeout=5), 0)
        with self.assertRaises(ProcessLookupError):
            os.kill(int(child_pid.read_text()), 0)
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))
        self.assertEqual(process.stdout.read(), b"")
        process.stdout.close()
        process.stderr.close()
        os.close(worker.acquire_lock(str(self.archive_dir)))

    def test_only_current_two_logs_are_exported_without_content_filtering(self):
        expected = {
            "access.log": b"2000/01/01 00:00:00 old request\n" + self.today_line(),
            "error.log": b"undated traceback\n" + b"x" * (2 << 20),
        }
        for name, content in expected.items():
            (self.root / name).write_bytes(content)
        for name in ("access.log.1", "error.log.1", "access.log.2.gz", "access.log.1.gz-2026101400.backup", "url.txt"):
            (self.root / name).write_bytes(b"ignored")
        nested = self.root / "nested"
        nested.mkdir()
        (nested / "access.log").write_bytes(b"ignored")
        with patch.object(worker.os, "fwalk", side_effect=AssertionError("must not enumerate directory")), patch.object(worker.os, "read", side_effect=AssertionError("must not pre-read contents")), patch.object(worker.os, "pread", side_effect=AssertionError("must not inspect contents")):
            self.assertEqual(self.scan(), 0)
        self.assertEqual(self.compress(), expected)
        for name, content in expected.items():
            self.assertEqual((self.root / name).read_bytes(), content)

    def test_preflight_uses_file_sizes_and_never_filters(self):
        access, error = b"old date and no timestamp\n", b"error\n"
        (self.root / "access.log").write_bytes(access)
        (self.root / "error.log").write_bytes(error)
        events = []
        with patch.object(worker, "check_environment"), patch.object(worker, "emit", side_effect=lambda phase, **fields: events.append(dict(phase=phase, **fields))), patch.object(worker, "compress", side_effect=RuntimeError("stop before compression")), patch.object(worker.os, "read", side_effect=AssertionError("must not read before compression")):
            with self.assertRaisesRegex(RuntimeError, "stop before compression"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertEqual([event["phase"] for event in events], ["checking", "checked"])
        checked = events[-1]
        self.assertEqual((checked["total"], checked["files"], checked["skipped"]), (len(access + error), 2, 0))

    def test_fifo_target_is_skipped_without_blocking(self):
        (self.root / "access.log").write_bytes(b"access")
        os.mkfifo(self.root / "error.log")
        self.assertEqual(self.scan(), 1)
        self.assertEqual(self.compress(), {"access.log": b"access"})

    def test_compressor_failure_reaps_child_and_run_removes_archive(self):
        (self.root / "access.log").write_bytes(self.today_line() * 1024)
        children, popen = [], subprocess.Popen
        def failing(*args, **kwargs):
            child = popen([sys.executable, "-c", "import sys; sys.stderr.write('compressor failed'); sys.exit(42)"], **kwargs)
            children.append(child)
            return child
        with patch.object(worker, "check_environment"), patch.object(worker.subprocess, "Popen", side_effect=failing), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "zstd"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].returncode, 42)
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))

    def test_disk_drop_terminates_stalled_compressor_and_removes_archive(self):
        (self.root / "access.log").write_bytes(self.today_line() * 16384)
        children, popen = [], subprocess.Popen
        def stalled(*args, **kwargs):
            child = popen([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
            children.append(child)
            return child
        def disk_pressure(*args):
            if children:
                raise RuntimeError("磁盘空间不足")
            return ENOUGH, worker.reserve_bytes(ENOUGH.total)
        start = time.monotonic()
        with patch.object(worker, "check_environment"), patch.object(worker, "check_space", side_effect=disk_pressure), patch.object(worker.subprocess, "Popen", side_effect=stalled), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "磁盘空间不足"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertLess(time.monotonic() - start, 5)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
        with self.assertRaises(ProcessLookupError):
            os.kill(children[0].pid, 0)
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))

    def test_compressor_setup_failure_still_reaps_started_child(self):
        popen, children = subprocess.Popen, []
        def spawn(*args, **kwargs):
            child = popen(*args, **kwargs)
            children.append(child)
            return child
        with patch.object(worker.subprocess, "Popen", side_effect=spawn), patch.object(worker.threading, "Thread", side_effect=RuntimeError("setup failed")), (self.archive_dir / "partial.zst").open("wb") as output:
            with self.assertRaisesRegex(RuntimeError, "setup failed"):
                with worker.compressor(output, str(self.archive_dir)):
                    self.fail("unexpected compressor ready")
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)

    def test_compressor_ignoring_terminate_is_killed_and_reaped(self):
        popen = subprocess.Popen
        ready = Path(self.temp.name) / "ready"
        children = []
        def stalled(*args, **kwargs):
            code = "import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(%r).touch(); time.sleep(60)" % str(ready)
            child = popen([sys.executable, "-c", code], **kwargs)
            children.append(child)
            return child
        with patch.object(worker.subprocess, "Popen", side_effect=stalled), (self.archive_dir / "partial.zst").open("wb") as output:
            with self.assertRaisesRegex(RuntimeError, "cancel"):
                with worker.compressor(output, str(self.archive_dir)):
                    deadline = time.monotonic() + 3
                    while not ready.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(ready.exists())
                    raise RuntimeError("cancel")
        self.assertEqual(children[0].returncode, -signal.SIGKILL)

    def test_checksum_and_incompressible_multiblock_content(self):
        content = os.urandom(4 << 20)
        (self.root / "access.log").write_bytes(content)
        self.scan()
        bound = worker.archive_bound(self.files)
        self.assertEqual(self.compress(), {"access.log": content})
        archive = self.archive_dir / "nginx-logs.tar.zst"
        self.assertLess(archive.stat().st_size, bound)
        frame = bytearray(archive.read_bytes())
        self.assertEqual(frame[:4], b"\x28\xb5\x2f\xfd")
        self.assertTrue(frame[4] & 4, "Zstandard frame checksum must be enabled")
        frame[-1] ^= 1
        corrupt = self.archive_dir / "corrupt.zst"
        corrupt.write_bytes(frame)
        self.assertNotEqual(subprocess.run(["zstd", "-t", str(corrupt)], capture_output=True).returncode, 0)

    @unittest.skipUnless(os.environ.get("NGINX_LOGS_LARGE_TEST") == "1", "opt-in isolated 1 GiB test")
    def test_gib_input_streams_with_bounded_memory(self):
        prefix = self.today_line().rstrip(b"\n")
        line = prefix + b"x" * (65536 - len(prefix) - 1) + b"\n"
        log = self.root / "access.log"
        digest = hashlib.sha256()
        with log.open("wb") as output:
            for _ in range(16384):
                output.write(line)
                digest.update(line)
        self.scan()
        bound = worker.archive_bound(self.files)
        archive = worker.compress(self.files, str(self.archive_dir), lambda _: None)
        self.assertLess(Path(archive).stat().st_size, bound)
        decoded = hashlib.sha256()
        with subprocess.Popen(["zstd", "-d", "-c", archive], stdout=subprocess.PIPE) as child:
            with tarfile.open(fileobj=child.stdout, mode="r|") as tar:
                member = tar.next()
                self.assertEqual(member.size, 1 << 30)
                source = tar.extractfile(member)
                while True:
                    data = source.read(worker.CHUNK)
                    if not data:
                        break
                    decoded.update(data)
                self.assertIsNone(tar.next())
            child.stdout.read()  # 读掉 tar 填充，让校验能跑完。
            self.assertEqual(child.wait(), 0)
        self.assertEqual(decoded.hexdigest(), digest.hexdigest())


class DependencyTests(unittest.TestCase):
    def test_missing_zstd_fails_without_fallback(self):
        with patch.object(worker.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "未安装 zstd"):
                worker.check_zstd()

    def test_default_zstd_needs_no_optional_capability_flags(self):
        with patch.object(worker.shutil, "which", return_value="/usr/bin/zstd"), patch.object(worker.subprocess, "check_output") as probe:
            worker.check_zstd()
            probe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
