#!/usr/bin/env bash
# Готовит звуки Kenney (CC0) для игры: моно, срезанная тишина в начале, выровненная громкость.
# Использование: tools/normalize-sounds.sh <папка-casino> <папка-interface> <папка-impact>
set -euo pipefail
CASINO=$1; UI=$2; IMPACT=$3
OUT="$(dirname "$0")/../src/renderer/src/assets/sounds"
mkdir -p "$OUT"

norm() { # src dst target_mean_db [extra_filter]
  local src=$1 dst=$2 target=$3 extra=${4:-}
  local mean max gain
  mean=$(ffmpeg -hide_banner -nostats -i "$src" -af volumedetect -f null - 2>&1 | sed -n 's/.*mean_volume: \([-0-9.]*\) dB/\1/p')
  max=$(ffmpeg -hide_banner -nostats -i "$src" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \([-0-9.]*\) dB/\1/p')
  gain=$(python3 -c "m=$mean; x=$max; t=$target; print(round(min(t-m, -0.8-x), 2))")
  local chain="silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.004,volume=${gain}dB"
  [ -n "$extra" ] && chain="$chain,$extra"
  ffmpeg -hide_banner -loglevel error -y -i "$src" -ac 1 -ar 44100 -af "$chain" -c:a libvorbis -q:a 4 "$OUT/$dst.ogg"
}

for i in 1 2 3 4 5 6 7 8; do norm "$CASINO/card-slide-$i.ogg" "card-slide-$i" -27; done
for i in 1 2 3 4; do norm "$CASINO/card-place-$i.ogg" "card-place-$i" -27; done
for i in 1 2 3 4; do norm "$CASINO/card-shove-$i.ogg" "card-shove-$i" -28; done
norm "$CASINO/card-shuffle.ogg" card-shuffle -30 "atrim=0:1.3,afade=t=out:st=0.9:d=0.4"
norm "$CASINO/card-fan-1.ogg" card-fan -28
for i in 1 2 3; do norm "$CASINO/chip-lay-$i.ogg" "chip-lay-$i" -26; done
for i in 1 2 3 4; do norm "$CASINO/chips-collide-$i.ogg" "chips-collide-$i" -27; done
for i in 1 3 4 5 6; do norm "$CASINO/chips-handle-$i.ogg" "chips-handle-$i" -27; done
for i in 1 2 3 4 5 6; do norm "$CASINO/chips-stack-$i.ogg" "chips-stack-$i" -26; done
for i in 0 1 2 3 4; do norm "$IMPACT/impactWood_light_00$i.ogg" "knock-$i" -22; done
norm "$UI/glass_001.ogg" turn -24
norm "$UI/glass_002.ogg" chime -24
norm "$UI/tick_002.ogg" tick -24
norm "$UI/click_001.ogg" click -24
norm "$UI/select_001.ogg" select -24
norm "$UI/toggle_001.ogg" toggle -24
norm "$UI/drop_002.ogg" message -24
norm "$UI/pluck_001.ogg" join -24
norm "$UI/pluck_002.ogg" leave -24
norm "$UI/confirmation_002.ogg" win -22
norm "$UI/maximize_006.ogg" level -24
ls "$OUT" | wc -l
du -sh "$OUT"
