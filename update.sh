#!/bin/bash
# 本机开发更新：构建成功后替换应用包，模型、文稿和偏好继续使用原目录。
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install_dir="/Applications/VoiceStudio.app"
should_open=true
has_install_path=false

usage() {
  cat <<'USAGE'
用法：./update.sh [--no-open] [安装路径]

默认构建、更新并打开 /Applications/VoiceStudio.app。
  --no-open   更新后不自动打开
  -h, --help  显示说明

示例：
  ./update.sh
  ./update.sh --no-open
  ./update.sh "$HOME/Applications/VoiceStudio.app"
USAGE
}

fail() { printf '更新失败：%s\n' "$*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --no-open) should_open=false ;;
    -*) fail "未知选项：$arg（使用 --help 查看用法）" ;;
    *)
      [[ "$has_install_path" == false ]] || fail "只能指定一个安装路径。"
      install_dir="${arg%/}"
      has_install_path=true
      ;;
  esac
done

[[ "$(uname -s)" == Darwin ]] || fail "此脚本用于更新本机 macOS 应用。"
[[ "$install_dir" == *.app ]] || fail "安装路径必须以 .app 结尾。"
[[ "$install_dir" == /* ]] || install_dir="$PWD/$install_dir"
[[ ! -L "$install_dir" ]] || fail "安装路径是符号链接，请指定实际应用路径。"
if [[ -e "$install_dir" ]]; then
  [[ -f "$install_dir/Contents/Info.plist" ]] || fail "目标已存在且不是应用包：$install_dir"
  installed_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$install_dir/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$installed_id" == local.voicestudio ]] || fail "目标不是 VoiceStudio，已保留：$install_dir"
fi

# Finder 双击时也能找到 Homebrew、Rust 与 nvm 管理的 Node；只调整当前进程。
export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin"
node_ready() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1);
  '
}
if ! node_ready; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_script" ]]; then
    set +u
    # nvm 不兼容 nounset；加载后恢复本脚本的严格模式。
    . "$nvm_script" --no-use || true
    nvm use --silent default >/dev/null 2>&1 || true
    set -u
  fi
fi
node_ready || fail "需要 Node.js 22.18 或更高版本。"
for tool in npm cargo codesign ditto osascript open; do
  command -v "$tool" >/dev/null 2>&1 || fail "找不到 $tool，请先安装对应的构建工具。"
done
xcode-select -p >/dev/null 2>&1 || fail "需要 Xcode Command Line Tools，可运行 xcode-select --install 安装。"

install_parent="$(dirname "$install_dir")"
mkdir -p "$install_parent"
install_parent="$(cd "$install_parent" && pwd -P)"
install_dir="$install_parent/$(basename "$install_dir")"
lock_dir="$install_parent/.$(basename "$install_dir").update-lock"
mkdir "$lock_dir" 2>/dev/null || fail "已有更新任务，或安装目录不可写：$install_parent。若上次更新被强制中断，请删除 $lock_dir 后重试。"

stage_dir=""
new_installed=false
install_complete=false
cleanup() {
  status=$?
  trap - EXIT
  set +e
  preserve_stage=false
  if [[ "$install_complete" == false ]]; then
    if [[ "$new_installed" == true ]]; then
      rm -rf "$install_dir"
    fi
    if [[ -n "$stage_dir" && -d "$stage_dir/previous.app" ]]; then
      if mv "$stage_dir/previous.app" "$install_dir"; then
        printf '已恢复原应用：%s\n' "$install_dir" >&2
      else
        preserve_stage=true
        printf '原应用保留在：%s/previous.app\n' "$stage_dir" >&2
      fi
    fi
  fi
  if [[ -n "$stage_dir" && "$preserve_stage" == false ]]; then
    rm -rf "$stage_dir"
  fi
  rmdir "$lock_dir" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$project_dir"
if [[ ! -x node_modules/.bin/tauri || ! -f node_modules/.package-lock.json ||
      package-lock.json -nt node_modules/.package-lock.json ||
      package.json -nt node_modules/.package-lock.json ]]; then
  printf '\n正在准备项目依赖…\n'
  npm ci --no-audit --no-fund
fi

printf '\n正在构建 VoiceStudio…\n'
./node_modules/.bin/tauri build --ci --no-sign --bundles app -- --locked
target_dir="$(cargo metadata --manifest-path "$project_dir/src-tauri/Cargo.toml" --no-deps --locked --format-version 1 | node -e '
  let input = "";
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => console.log(JSON.parse(input).target_directory));
')"
if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
  target_dir="$target_dir/$CARGO_BUILD_TARGET"
fi
app_dir="$target_dir/release/bundle/macos/VoiceStudio.app"
[[ -f "$app_dir/Contents/Info.plist" ]] || fail "没有找到构建产物：$app_dir"
built_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_dir/Contents/Info.plist")"
[[ "$built_id" == local.voicestudio ]] || fail "构建产物的应用标识不正确。"

printf '\n正在签名并检查应用…\n'
codesign --force --deep --sign - "$app_dir"
codesign --verify --deep --strict "$app_dir"

# 先在安装目录所在磁盘完整复制并验签，再退出旧版、切换目录。
stage_dir="$(mktemp -d "$install_parent/.voicestudio-update.XXXXXX")"
ditto "$app_dir" "$stage_dir/new.app"
codesign --verify --deep --strict "$stage_dir/new.app"
app_running() { pgrep -f '/Contents/MacOS/voice-studio-app([[:space:]]|$)' >/dev/null 2>&1; }
if app_running; then
  printf '\n正在退出旧版 VoiceStudio…\n'
  osascript -e 'tell application id "local.voicestudio" to quit' >/dev/null 2>&1 || true
  for ((attempt = 0; attempt < 50; attempt++)); do
    app_running || break
    sleep 0.2
  done
  if app_running; then
    fail "应用尚未退出。请结束当前任务并退出 VoiceStudio 后重试；原应用未替换。"
  fi
fi

if [[ -e "$install_dir" ]]; then
  mv "$install_dir" "$stage_dir/previous.app"
fi
new_installed=true
mv "$stage_dir/new.app" "$install_dir"
codesign --verify --deep --strict "$install_dir"
touch "$install_dir"
install_complete=true

if [[ "$should_open" == true ]]; then
  open "$install_dir" || fail "应用已更新，但未能自动打开，请从安装位置手动打开。"
fi
printf '\n已更新%s：%s\n' "$(if [[ "$should_open" == true ]]; then printf '并打开'; fi)" "$install_dir"
printf '模型、声音、文稿和设置继续使用原来的本机数据。\n'
