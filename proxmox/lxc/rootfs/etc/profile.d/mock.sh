# Mock: banner and where to open the app, on login shells.
if [ -n "$BASH_VERSION" ] && [ -r /usr/local/lib/mock/banner.sh ]; then
  . /usr/local/lib/mock/banner.sh && mock_banner
  echo -e "    \e[1;38;2;249;171;0m●\e[0m Mock $(cat /etc/mock-release 2>/dev/null): \e[1mhttps://$(hostname -I | awk '{print $1}')\e[0m   setup token: \e[1mmock-token\e[0m   upgrade: \e[1mupdate\e[0m"
  echo ""
fi
