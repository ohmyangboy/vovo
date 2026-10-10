#!/bin/bash
# 在 Finder 中双击即可更新；失败信息保留在终端窗口中。
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
"$project_dir/update.sh" "$@" || status=$?
if [[ -t 0 ]]; then
  printf '\n按回车结束…'
  read -r answer
fi
exit "$status"
