import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, mkdir, copyFile, writeFile, chmod, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = new URL("../update.sh", import.meta.url);
const plist = (identifier) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`;

async function fixture(mode, { noOpen = false, identifier = "local.vovo", installedPresent = true, legacyIdentifier = null } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vovo-update-test-")));
  const project = join(root, "source with spaces");
  const bin = join(root, "mock-tools");
  const parent = join(root, "Applications with spaces");
  const installed = join(parent, "vovo with spaces.app");
  const legacy = join(parent, "VoiceStudio.app");
  const events = join(root, "events");
  const running = join(root, "running");
  const data = join(root, "existing-model-and-draft");
  await mkdir(join(project, "node_modules", ".bin"), { recursive: true });
  await mkdir(parent, { recursive: true });
  if (installedPresent) {
    await mkdir(join(installed, "Contents"), { recursive: true });
    await writeFile(join(installed, "Contents", "Info.plist"), plist(identifier));
    await writeFile(join(installed, "version"), "old");
  }
  if (legacyIdentifier) {
    await mkdir(join(legacy, "Contents"), { recursive: true });
    await writeFile(join(legacy, "Contents", "Info.plist"), plist(legacyIdentifier));
    await writeFile(join(legacy, "version"), "legacy");
  }
  await mkdir(bin);
  await copyFile(source, join(project, "update.sh"));
  await chmod(join(project, "update.sh"), 0o755);
  await writeFile(join(project, "package.json"), "{}\n");
  await writeFile(join(project, "package-lock.json"), "{}\n");
  await writeFile(join(project, "node_modules", ".package-lock.json"), "{}\n");
  await writeFile(data, "existing model and draft");
  await writeFile(events, "");
  await writeFile(running, "running");

  async function executable(path, body) {
    await writeFile(path, "#!/bin/bash\nset -e\n" + body + "\n");
    await chmod(path, 0o755);
  }
  await executable(join(project, "node_modules", ".bin", "tauri"), `
printf 'build\\n' >> "$VOVO_TEST_EVENTS"
[[ "$VOVO_TEST_MODE" != build-fail ]] || exit 9
app="$VOVO_TEST_TARGET/release/bundle/macos/vovo.app"
mkdir -p "$app/Contents"
cat > "$app/Contents/Info.plist" <<'PLIST'
${plist("local.vovo")}
PLIST
printf 'new' > "$app/version"`);
  await executable(join(bin, "cargo"), `node -e 'console.log(JSON.stringify({target_directory:process.env.VOVO_TEST_TARGET}))'`);
  await executable(join(bin, "npm"), `printf 'dependencies\\n' >> "$VOVO_TEST_EVENTS"`);
  await executable(join(bin, "codesign"), `
for arg in "$@"; do last="$arg"; done
if [[ "$VOVO_TEST_MODE" == signature-fail && "$*" == *--verify* && "$last" == "$VOVO_TEST_INSTALL" ]]; then exit 8; fi`);
  await executable(join(bin, "pgrep"), `[[ -f "$VOVO_TEST_RUNNING" ]]`);
  await executable(join(bin, "osascript"), `
printf 'quit\\n' >> "$VOVO_TEST_EVENTS"
if [[ "$VOVO_TEST_MODE" != quit-refused ]]; then rm -f "$VOVO_TEST_RUNNING"; fi`);
  await executable(join(bin, "sleep"), "exit 0");
  await executable(join(bin, "open"), `printf 'open:%s\\n' "$1" >> "$VOVO_TEST_EVENTS"`);
  await executable(join(bin, "ditto"), `
[[ "$VOVO_TEST_MODE" != copy-fail ]] || exit 7
/usr/bin/ditto "$@"`);
  await executable(join(bin, "mv"), `
if [[ "$VOVO_TEST_MODE" == swap-fail && "$1" == */new.app ]]; then exit 6; fi
if [[ "$VOVO_TEST_MODE" == retire-fail && "$1" == */VoiceStudio.app ]]; then exit 6; fi
/bin/mv "$@"`);

  const result = spawnSync("/bin/bash", [join(project, "update.sh"), ...(noOpen ? ["--no-open"] : []), installed], {
    cwd: root,
    env: {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      CARGO_BUILD_TARGET: "",
      VOVO_TEST_MODE: mode,
      VOVO_TEST_TARGET: join(project, "target"),
      VOVO_TEST_INSTALL: installed,
      VOVO_TEST_EVENTS: events,
      VOVO_TEST_RUNNING: running,
    },
    encoding: "utf8",
    timeout: 15000,
  });
  return {
    root, result,
    version: await readFile(join(installed, "version"), "utf8").catch(() => null),
    legacyVersion: await readFile(join(legacy, "version"), "utf8").catch(() => null),
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
    assert.match(f.events, /build\n(?:quit\n)+open:/);
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

test("首次改名从旧应用升级，成功后清理旧应用包", options, async () => {
  await check("success", { installedPresent: false, legacyIdentifier: "local.voicestudio" }, f => {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.version, "new");
    assert.equal(f.legacyVersion, null);
  });
});
for (const mode of ["signature-fail", "retire-fail"]) {
  test(`${mode} 时保留旧品牌应用，恢复已有 vovo 应用`, options, async () => {
    await check(mode, { legacyIdentifier: "local.voicestudio" }, f => {
      assert.notEqual(f.result.status, 0);
      assert.equal(f.version, "old");
      assert.equal(f.legacyVersion, "legacy");
    });
  });
}
test("自定义旧应用位置也可以直接升级", options, async () => {
  await check("success", { identifier: "local.voicestudio" }, f => {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.version, "new");
  });
});
test("同名但不同标识的旧应用不会被清理", options, async () => {
  await check("success", { legacyIdentifier: "example.unrelated" }, f => {
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(f.legacyVersion, "legacy");
  });
});
