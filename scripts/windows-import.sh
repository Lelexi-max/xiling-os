#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: windows-import.sh WINDOWS_PATH PROJECT_ID" >&2
  exit 64
fi

case "$2" in
  *[!A-Za-z0-9_-]*|'') echo "unsafe project id" >&2; exit 65 ;;
esac

source_path=$(wslpath -u "$1")
if [ ! -f "$source_path" ] || [ -L "$source_path" ]; then
  echo "source must be a regular non-symlink file" >&2
  exit 66
fi

target_root="/home/xiling/projects/$2/imports"
mkdir -p "$target_root"
temporary=$(mktemp "$target_root/.incoming.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
cp -- "$source_path" "$temporary"
digest=$(sha256sum "$temporary" | cut -d ' ' -f 1)
target="$target_root/$digest"
if [ -e "$target" ]; then
  rm -f "$temporary"
else
  mv "$temporary" "$target"
fi
trap - EXIT HUP INT TERM
printf 'artifact://%s\n' "$digest"
