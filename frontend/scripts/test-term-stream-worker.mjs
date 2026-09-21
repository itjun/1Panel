import { buildSync } from "esbuild";
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmpDir = join(root, "node_modules/.cache/ipannel-tests");
mkdirSync(tmpDir, { recursive: true });
const outfile = join(tmpDir, "termStreamWorker.cjs");

buildSync({
  entryPoints: [join(root, "src/workers/termStreamWorker.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("socket is not open");
    this.sent.push(data);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  deliver(data) {
    this.onmessage?.({ data });
  }
}

const workerMessages = [];
globalThis.WebSocket = FakeWebSocket;
globalThis.self = {
  onmessage: null,
  postMessage(message) {
    workerMessages.push(message);
  },
};

const require = createRequire(import.meta.url);
require(outfile);

function send(command) {
  globalThis.self.onmessage({ data: command });
}

function frame(type, bytes) {
  return Uint8Array.from([type, ...bytes]).buffer;
}

async function waitFor(predicate, message, timeout = 500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

send({ type: "connect", base: "http://127.0.0.1:43123", token: "token", sid: "sid-a" });
assert.strictEqual(FakeWebSocket.instances.length, 1);
const first = FakeWebSocket.instances[0];
assert.ok(first.url.includes("/ws?t=token&sid=sid-a"));
first.open();
assert.ok(workerMessages.some((message) => message.type === "ready"));

send({ type: "input", data: "ls\n" });
assert.deepStrictEqual(Array.from(first.sent[0]), [1, 108, 115, 10]);

workerMessages.length = 0;
first.deliver(frame(1, [0xe4]));
first.deliver(frame(1, [0xb8, 0xad]));
await waitFor(
  () => workerMessages.some((message) => message.type === "data" && message.data === "中"),
  "UTF-8 output fragments were not joined correctly",
);

class SlowBlob extends Blob {
  arrayBuffer() {
    return new Promise((resolve) => {
      setTimeout(() => resolve(Uint8Array.from([1, 0x58]).buffer), 30);
    });
  }
}

workerMessages.length = 0;
first.deliver(new SlowBlob([Uint8Array.from([1, 0x58])]));
first.close();
await new Promise((resolve) => setTimeout(resolve, 60));
assert.ok(!workerMessages.some((message) => message.type === "data" && message.data === "X"));

await waitFor(() => FakeWebSocket.instances.length === 2, "worker did not reconnect", 1800);
const second = FakeWebSocket.instances[1];
second.open();
workerMessages.length = 0;
second.deliver(frame(1, [0xe5]));
first.close();
second.deliver(frame(1, [0xa5, 0xbd]));
await waitFor(
  () => workerMessages.some((message) => message.type === "data" && message.data === "好"),
  "reconnected socket retained stale UTF-8 decoder state",
);
assert.ok(!workerMessages.some((message) => message.type === "data" && message.data.includes("�")));

send({ type: "stop" });
console.log("test-term-stream-worker: ok");
