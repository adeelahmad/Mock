#!/usr/bin/env bash
# Mock: the terminal banner (brand kit v1.0, robot identity): a blue M, the robot o with its gold
# antenna, "ck", and the gold recording dot. ct/mock.sh shows it as the header; the container's
# login MOTD shows it too. Run it directly to preview.

mock_banner() {
  local b='' g='' w='' d='' r=''
  if [[ -t 1 && "${TERM:-dumb}" != dumb && -z "${NO_COLOR:-}" ]]; then
    b=$'\e[1;38;2;26;115;232m' g=$'\e[1;38;2;249;171;0m' w=$'\e[1m' d=$'\e[2m' r=$'\e[0m'
  fi
  cat <<BANNER

${b}  ███╗   ███╗${r}
${b}  ████╗ ████║      ${g}●${b}     ${r} ${w} ██████╗██╗  ██╗${r}
${b}  ██╔████╔██║      │     ${r} ${w}██╔════╝██║ ██╔╝${r}
${b}  ██║╚██╔╝██║   ╭──┴──╮  ${r} ${w}██║     █████╔╝${r}
${b}  ██║ ╚═╝ ██║  ▐│▀▀ ▀▀│▌ ${r} ${w}██║     ██╔═██╗ ${r}  ${g}▄██▄${r}
${b}  ╚═╝     ╚═╝  ▐│ ╰─╯ │▌ ${r} ${w}╚██████╗██║  ██╗${r}  ${g}▀██▀${r}
${b}                ╰─────╯  ${r} ${w} ╚═════╝╚═╝  ╚═╝${r}
${d}  Voice interview practice · Practise. Get coached. Try again.${r}

BANNER
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then mock_banner; fi
