import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, mkdir, copyFile, writeFile, chmod, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = new URL("../update.sh", import.meta.url);
const plist = (identifier) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`;

async function fixture(mode, { noOpen = false, identifier = "local.voicestudio" } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "voice-studio-update-test-")));
  const project = join(root, "source with spaces");
  const bin = join(root, "mock-tools");
  const parent = join(root, "Applications with spaces");
  const installed = join(parent, "Voice Studio.app");
  const events = join(root, "events");
  const running = join(root, "running");
  const data = join(root, "existing-model-and-draft");
  await mkdir(join(project, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(installed, "Contents"), { recursive: true });
  await mkdir(bin);
  await copyFile(source, join(project, "update.sh"));
  await chmod(join(project, "update.sh"), 0o755);
  await writeFile(join(project, "package.json"), "{}\n");
  await writeFile(join(project, "package-lock.json"), "{}\n");
  await writeFile(join(project, "node_modules", ".package-lock.json"), "{}\n");
  await writeFile(join(installed, "Contents", "Info.plist"), plist(identifier));
  await writeFile(join(installed, "version"), "old");
  await writeFile(data, "existing model and draft");
  await writeFile(events, "");
  await writeFile(running, "running");

  async function executable(path, body) {
    await writeFile(path, "#!/bin/bash\nset -e\n" + body + "\n");
    await chmod(path, 0o755);
  }
  await executable(join(project, "node_modules", ".bin", "tauri"), `
printf 'build\\n' >> "$VS_TEST_EVENTS"
[[ "$VS_TEST_MODE" != build-fail ]] || exit 9
app="$VS_TEST_TARGET/release/bundle/macos/VoiceStudio.app"
mkdir -p "$app/Contents"
cat > "$app/Contents/Info.plist" <<'PLIST'
${plist("local.voicestudio")}
PLIST
printf 'new' > "$app/version"`);
  await executable(join(bin, "cargo"), `node -e 'console.log(JSON.stringify({target_directory:process.env.VS_TEST_TARGET}))'`);
  await executable(join(bin, "npm"), `printf 'dependencies\\n' >> "$VS_TEST_EVENTS"`);
  await executable(join(bin, "codesign"), `
for arg in "$@"; do last="$arg"; done
if [[ "$VS_TEST_MODE" == signature-fail && "$*" == *--verify* && "$last" == "$VS_TEST_INSTALL" ]]; then exit 8; fi`);
  await executable(join(bin, "pgrep"), `[[ -f "$VS_TEST_RUNNING" ]]`);
  await executable(join(bin, "osascript"), `
printf 'quit\\n' >> "$VS_TEST_EVENTS"
if [[ "$VS_TEST_MODE" != quit-refused ]]; then rm -f "$VS_TEST_RUNNING"; fi`);
  await executable(join(bin, "sleep"), "exit 0");
  await executable(join(bin, "open"), `printf 'open:%s\\n' "$1" >> "$VS_TEST_EVENTS"`);
  await executable(join(bin, "ditto"), `
[[ "$VS_TEST_MODE" != copy-fail ]] || exit 7
/usr/bin/ditto "$@"`);
  await executable(join(bin, "mv"), `
if [[ "$VS_TEST_MODE" == swap-fail && "$1" == */new.app ]]; then exit 6; fi
/bin/mv "$@"`);

  const result = spawnSync("/bin/bash", [join(project, "update.sh"), ...(noOpen ? ["--no-open"] : []), installed], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      CARGO_BUILD_TARGET: "",
      VS_TEST_MODE: mode,
      VS_TEST_TARGET: join(project, "target"),
      VS_TEST_INSTALL: installed,
      VS_TEST_EVENTS: events,
      VS_TEST_RUNNING: running,
    },
    encoding: "utf8",
    timeout: 15000,
  });
  return {
    root, result,
    version: await readFile(join(installed, "version"), "utf8"),
    data: await readFile(data, "utf8"),
    events: await readFile(events, "utf8"),
    remaining: (await readdir(parent)).filter(name => name.startsWith(".")),
  };
}

const options = { skip: process.platform !== "darwin" };
async function check(mode, config, verify) {
  const f = await fixture(mode, config);
  try {
    verify(f);
    assert.equal(f.data, "existing model and draft");
    assert.deepEqual(f.remaining, []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}

test("从任意目录更新含空格的安装路径，并打开新版", options, async () => {
  await check("success", {}, f => {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.version, "new");
    assert.match(f.events, /build\nquit\nopen:/);
  });
});

test("--no-open 安装成功后不启动应用", options, async () => {
  await check("success", { noOpen: true }, f => {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.version, "new");
    assert.doesNotMatch(f.events, /open:/);
  });
});

for (const mode of ["build-fail", "copy-fail", "quit-refused", "swap-fail", "signature-fail"]) {
  test(`${mode} 时原应用保留或恢复`, options, async () => {
    await check(mode, {}, f => {
      assert.notEqual(f.result.status, 0);
      assert.equal(f.version, "old");
      assert.doesNotMatch(f.events, /open:/);
      if (mode === "build-fail" || mode === "copy-fail") assert.doesNotMatch(f.events, /quit/);
    });
  });
}

test("拒绝覆盖其他应用", options, async () => {
  await check("success", { identifier: "example.unrelated" }, f => {
    assert.notEqual(f.result.status, 0);
    assert.equal(f.version, "old");
    assert.equal(f.events, "");
  });
});
