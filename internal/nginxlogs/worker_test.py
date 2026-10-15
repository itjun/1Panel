import contextlib
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
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


@contextlib.contextmanager
def host_timezone(name):
    try:
        with patch.dict(os.environ, {"TZ": name}):
            time.tzset()
            worker.parse_timestamp.cache_clear()
            yield
    finally:
        time.tzset()
        worker.parse_timestamp.cache_clear()


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
        self.pacer = worker.Pacer()
        worker.LOCAL_READY.set()

    def close_files(self):
        for _, fd, _ in self.files:
            if fd is not None:
                os.close(fd)
        self.files.clear()

    def scan(self):
        return worker.inventory(str(self.root), self.files, self.pacer)

    def today_line(self):
        return (time.strftime("%Y/%m/%d %H:%M:%S") + " [info] current request\n").encode()

    def compress(self, selections=None):
        with patch.object(worker.shutil, "disk_usage", return_value=ENOUGH):
            archive = worker.compress(self.files, str(self.archive_dir), lambda n: None, self.pacer, selections)
        with tarfile.open(archive) as package:
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
        os.symlink("/dev/zero", self.root / "device.log")
        os.mkfifo(self.root / "fifo")
        os.symlink(self.archive_dir, self.root / "linked")
        (self.archive_dir / "secret").write_bytes(b"secret")
        self.assertEqual(self.scan(), 2)
        self.assertEqual(self.compress(), {"error.log": b"error"})

    def test_spaces_quotes_unicode_and_nested_names(self):
        child = self.root / "sub directory"
        child.mkdir()
        name = "sub directory/访问 ' $(touch nope).log"
        (self.root / name).write_bytes(b"log")
        self.scan()
        self.assertEqual(self.compress(), {name: b"log"})

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
        self.assertGreater(bound, (self.archive_dir / "nginx-logs.tar.gz").stat().st_size)
        with patch.object(worker.shutil, "disk_usage", return_value=Usage(20 << 30, 0, (2 << 30) + bound - 1)):
            with self.assertRaisesRegex(RuntimeError, "磁盘空间不足"):
                worker.check_space(str(self.archive_dir), bound)
        self.assertEqual(worker.reserve_bytes(1 << 30), 1 << 30)

    def test_disk_drop_mid_compression_stops_reading(self):
        (self.root / "access.log").write_bytes(b"a" * (worker.CHUNK * 2))
        self.scan()
        with patch.object(worker.shutil, "disk_usage", side_effect=[ENOUGH, Usage(20 << 30, 0, 1)]):
            with self.assertRaisesRegex(RuntimeError, "磁盘空间不足"):
                worker.compress(self.files, str(self.archive_dir), lambda n: None, self.pacer)
        self.assertEqual(os.lseek(self.files[0][1], 0, os.SEEK_CUR), worker.CHUNK)

    def test_empty_and_excessive_file_count_fail(self):
        with self.assertRaisesRegex(RuntimeError, "没有"):
            self.scan()
        (self.root / "a.log").touch()
        (self.root / "b.log").touch()
        with patch.object(worker, "MAX_FILES", 1):
            with self.assertRaisesRegex(RuntimeError, "超过"):
                self.scan()

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

    def test_throughput_is_throttled(self):
        pacer = worker.Pacer()
        start = time.monotonic()
        pacer.step(worker.RATE // 4)
        self.assertGreaterEqual(time.monotonic() - start, 0.24)

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

    def test_linux_protection_failures_do_not_silently_downgrade(self):
        with patch.object(worker.sys, "platform", "linux"), patch.object(worker.os, "getpriority", return_value=0):
            with self.assertRaisesRegex(RuntimeError, "最低 CPU"):
                worker.check_environment(str(self.archive_dir))
        with patch.object(worker.sys, "platform", "linux"), patch.object(worker.os, "getpriority", return_value=19), patch.object(worker.subprocess, "check_output", return_value=b"best-effort: prio 4"):
            with self.assertRaisesRegex(RuntimeError, "磁盘 I/O"):
                worker.check_environment(str(self.archive_dir))
        with patch.object(worker.sys, "platform", "linux"), patch.object(worker.os, "getpriority", return_value=19), patch.object(worker.subprocess, "check_output", side_effect=[b"idle", b"tmpfs"]):
            with self.assertRaisesRegex(RuntimeError, "内存文件系统"):
                worker.check_environment(str(self.archive_dir))

    def test_heartbeat_eof_terminates_worker_and_cleans_archive(self):
        (self.root / "access.log").write_bytes(self.today_line() * 8192)
        # Exercise the real entrypoint, heartbeat, signals and cleanup on macOS too;
        # only Linux capability probes are stubbed in this portable test.
        code = Path(worker.__file__).read_text().replace('lock_parent="/tmp"', "lock_parent=" + repr(str(self.archive_dir))).replace('        check_environment(parent)', '        pass # platform probe tested on Linux')
        process = subprocess.Popen([sys.executable, "-u", "-c", code, str(self.root), str(self.archive_dir)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        process.stdin.write(b".A")
        process.stdin.flush()
        while True:
            line = process.stderr.readline()
            self.assertTrue(line, "worker exited before compression")
            if json.loads(line)["phase"] == "compressing":
                break
        process.stdin.close()
        self.assertNotEqual(process.wait(timeout=5), 0)
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))
        self.assertEqual(process.stdout.read(), b"")
        process.stdout.close()
        process.stderr.close()
        os.close(worker.acquire_lock(str(self.archive_dir)))

    def test_today_uses_host_timezone_and_excludes_adjacent_days(self):
        with host_timezone("Asia/Shanghai"):
            before = b'ip - - [14/Oct/2026:15:59:59 +0000] "yesterday"\n'
            first = b'ip - - [14/Oct/2026:16:00:00 +0000] "today begins"\n'
            error = b'2026/10/15 12:00:00 [error] request\n'
            iso = b'{"time_iso8601":"2026-10-15T15:59:59Z","message":"today ends"}\n'
            following = b'ip - - [15/Oct/2026:16:00:00 +0000] "tomorrow"\n'
            unknown = b'no recognizable timestamp\n'
            content = before + first + following + error + unknown + iso
            (self.root / "access.log").write_bytes(content)
            self.scan()
            window = worker.day_window(datetime.date(2026, 10, 15))
            selections, unmatched, excluded = worker.select_today(self.files, str(self.archive_dir), self.pacer, window, lambda _: None)
            self.assertEqual((unmatched, excluded), (1, 0))
            self.assertLess(worker.archive_bound(self.files, selections), worker.archive_bound(self.files))
            self.assertEqual(self.compress(selections), {"access.log": first + error + iso})
            self.assertEqual((self.root / "access.log").read_bytes(), content)

    def test_today_keeps_uncompressed_rotation_but_skips_archives(self):
        content = self.today_line()
        (self.root / "access.log.1").write_bytes(content)
        (self.root / "access.log.2.gz").write_bytes(b"not read or decompressed")
        (self.root / "error.log").touch()
        skipped = worker.inventory(str(self.root), self.files, self.pacer, text_only=True)
        selections, _, excluded = worker.select_today(self.files, str(self.archive_dir), self.pacer, worker.day_window(), lambda _: None)
        self.assertEqual((skipped, excluded), (1, 1))
        self.assertEqual(self.compress(selections), {"access.log.1": content})

    def test_today_selection_survives_rotation_and_excludes_later_append(self):
        log = self.root / "access.log"
        content = self.today_line()
        log.write_bytes(content)
        self.scan()
        selections, _, _ = worker.select_today(self.files, str(self.archive_dir), self.pacer, worker.day_window(), lambda _: None)
        with log.open("ab") as output:
            output.write(content)
        log.rename(self.root / "access.log.1")
        log.write_bytes(b"new active file")
        self.assertEqual(self.compress(selections), {"access.log": content})
        self.assertEqual(log.read_bytes(), b"new active file")

    def test_no_today_records_fails_without_exporting_old_or_unknown_lines(self):
        (self.root / "access.log").write_bytes(b'2000/01/01 00:00:00 old\nunknown date\n')
        with patch.object(worker, "check_environment"), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "没有找到.*日志记录"):
                worker.run(str(self.root), str(self.archive_dir), str(self.archive_dir))
        self.assertFalse(list(self.archive_dir.glob("1panel-nginx-*")))

    def test_selection_limits_line_length_and_fragment_memory(self):
        log = self.root / "access.log"
        log.write_bytes(b"x" * (worker.MAX_LINE + 1))
        self.scan()
        with self.assertRaisesRegex(RuntimeError, "单行日志"):
            worker.select_today(self.files, str(self.archive_dir), self.pacer, worker.day_window(), lambda _: None)
        self.close_files()
        log.write_bytes((self.today_line() + b"2000/01/01 00:00:00 old\n") * 3)
        self.scan()
        with patch.object(worker, "MAX_RANGES", 2), self.assertRaisesRegex(RuntimeError, "片段过多"):
            worker.select_today(self.files, str(self.archive_dir), self.pacer, worker.day_window(), lambda _: None)

    def test_selection_detects_truncation(self):
        log = self.root / "access.log"
        log.write_bytes(self.today_line() * 3)
        self.scan()
        log.write_bytes(self.today_line())
        with self.assertRaisesRegex(RuntimeError, "截断"):
            worker.select_today(self.files, str(self.archive_dir), self.pacer, worker.day_window(), lambda _: None)

    def test_day_boundaries_account_for_daylight_saving(self):
        with host_timezone("America/New_York"):
            _, start, end = worker.day_window(datetime.date(2026, 3, 8))
            self.assertEqual(end - start, 23 * 3600)
            _, start, end = worker.day_window(datetime.date(2026, 11, 1))
            self.assertEqual(end - start, 25 * 3600)

    def test_primary_access_timestamp_wins_over_date_in_request(self):
        line = b'ip - - [14/Oct/2026:10:00:00 +0800] "time":"2026-10-15T10:00:00+08:00"\n'
        stamp = worker.line_timestamp(line)
        self.assertEqual(stamp, datetime.datetime(2026, 10, 14, 2, tzinfo=datetime.timezone.utc).timestamp())
        self.assertIsNone(worker.line_timestamp(b'ip [32/Oct/2026:10:00:00 +0800] invalid\n'))


if __name__ == "__main__":
    unittest.main()
