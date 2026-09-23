import { buildSync } from "esbuild";
import { createRequire } from "module";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import assert from "assert";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const outDir = join(root, "node_modules/.cache/ipannel-tests");
const outfile = join(outDir, "sftpLocationState.cjs");
mkdirSync(outDir, { recursive: true });

buildSync({
  entryPoints: [join(root, "src/utils/sftpLocationState.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const { getSftpLocation, saveSftpLocation } = require(outfile);

saveSftpLocation("panel-a", { remoteCwd: "/etc/nginx" });
saveSftpLocation("panel-b", { remoteCwd: "/var/log" });

assert.strictEqual(
  getSftpLocation("panel-a").remoteCwd,
  "/etc/nginx",
  "switching to another host must not reset panel-a's XFPT directory",
);
assert.strictEqual(getSftpLocation("panel-b").remoteCwd, "/var/log");

console.log("test-sftp-location-state: ok");
