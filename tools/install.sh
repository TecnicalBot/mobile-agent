#!/bin/sh
# Mobile Agent ACP bridge installer.
#
#   curl -fsSL https://raw.githubusercontent.com/tecnicalbot/mobile-agent/main/tools/install.sh | sh
#
# Installs a portable Node.js when needed, downloads the single-file bridge,
# creates a stable token, and adds the short `mabridge` command to PATH.
set -eu

MAB_HOME="${MAB_HOME:-$HOME/.mobile-agent}"
MAB_BIN_DIR="${MAB_BIN_DIR:-$HOME/.local/bin}"
MAB_BRIDGE_URL="${MAB_BRIDGE_URL:-https://raw.githubusercontent.com/tecnicalbot/mobile-agent/main/tools/acp-bridge/bridge.mjs}"
MAB_TOKEN_FILE="${MOBILE_AGENT_BRIDGE_TOKEN_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/mobile-agent/bridge-token}"
MAB_NODE_MIN_MAJOR="${MAB_NODE_MIN_MAJOR:-22}"
MAB_NO_PATH="${MAB_NO_PATH:-0}"
MAB_FORCE_NODE="${MAB_FORCE_NODE:-0}"
MAB_SKIP_QR="${MAB_SKIP_QR:-0}"

say() {
  printf '%s\n' "$*"
}

warn() {
  printf '! %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

download() {
  url="$1"
  out="$2"
  if have curl; then
    curl -fsSL "$url" -o "$out"
  elif have wget; then
    wget -qO "$out" "$url"
  else
    die "curl or wget is required to download the bridge."
  fi
}

download_stdout() {
  url="$1"
  if have curl; then
    curl -fsSL "$url"
  elif have wget; then
    wget -qO- "$url"
  else
    die "curl or wget is required to download Node.js."
  fi
}

node_major() {
  "$1" -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || printf '0'
}

detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux*) node_os=linux ;;
    Darwin*) node_os=darwin ;;
    *) die "Unsupported OS: $os. On Windows, use the npm package or WSL." ;;
  esac
  case "$arch" in
    x86_64|amd64) node_arch=x64 ;;
    arm64|aarch64) node_arch=arm64 ;;
    armv7l) node_arch=armv7l ;;
    ppc64le) node_arch=ppc64le ;;
    s390x) node_arch=s390x ;;
    *) die "Unsupported architecture: $arch" ;;
  esac
}

checksum() {
  file="$1"
  if have sha256sum; then
    sha256sum "$file" | awk '{print $1}'
  elif have shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    printf ''
  fi
}

install_portable_node() {
  detect_platform
  say "Node.js $MAB_NODE_MIN_MAJOR+ is required. Downloading a portable copy..."
  dist="https://nodejs.org/dist/latest-v${MAB_NODE_MIN_MAJOR}.x"
  sums=$(download_stdout "$dist/SHASUMS256.txt")
  file=$(printf '%s\n' "$sums" | awk '{print $2}' | grep "node-v.*-$node_os-$node_arch.tar.gz$" | head -1)
  [ -n "$file" ] || die "Could not find a Node.js build for $node_os-$node_arch."

  tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/mab-node.XXXXXX")
  trap 'rm -rf "$tmpdir"' EXIT
  download "$dist/$file" "$tmpdir/$file"

  expected=$(printf '%s\n' "$sums" | grep "  $file$" | awk '{print $1}' | head -1)
  actual=$(checksum "$tmpdir/$file")
  if [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" != "$actual" ]; then
    die "The Node.js download checksum did not match."
  fi

  tar -xzf "$tmpdir/$file" -C "$tmpdir"
  extracted="$tmpdir/${file%.tar.gz}"
  [ -x "$extracted/bin/node" ] || die "The Node.js archive did not contain bin/node."
  rm -rf "$MAB_HOME/node"
  mkdir -p "$MAB_HOME"
  mv "$extracted" "$MAB_HOME/node"
  rm -rf "$tmpdir"
  trap - EXIT
  NODE_BIN="$MAB_HOME/node/bin/node"
  NODE_DIR="$MAB_HOME/node"
}

install_node() {
  if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX" ] && have pkg; then
    say "Detected Termux. Installing Node.js with pkg..."
    pkg install -y nodejs
    NODE_BIN=$(command -v node)
    NODE_DIR=$(dirname "$(dirname "$NODE_BIN")")
    return
  fi
  if [ -f /etc/alpine-release ] && have apk; then
    say "Detected Alpine Linux. Installing Node.js with apk..."
    if [ "$(id -u)" -eq 0 ]; then
      apk add --no-cache nodejs npm
    elif have sudo; then
      sudo apk add --no-cache nodejs npm
    else
      die "Run as root or install Node.js manually: apk add nodejs npm"
    fi
    NODE_BIN=$(command -v node)
    NODE_DIR=$(dirname "$(dirname "$NODE_BIN")")
    return
  fi
  install_portable_node
}

# Prefer an existing Node.js 22+ install.
NODE_BIN=""
NODE_DIR=""
if [ "$MAB_FORCE_NODE" != "1" ] && have node; then
  system_node=$(command -v node)
  if [ "$(node_major "$system_node")" -ge "$MAB_NODE_MIN_MAJOR" ]; then
    NODE_BIN="$system_node"
    NODE_DIR=$(dirname "$(dirname "$NODE_BIN")")
  fi
fi
if [ -z "$NODE_BIN" ] && [ -x "$MAB_HOME/node/bin/node" ]; then
  if [ "$(node_major "$MAB_HOME/node/bin/node")" -ge "$MAB_NODE_MIN_MAJOR" ]; then
    NODE_BIN="$MAB_HOME/node/bin/node"
    NODE_DIR="$MAB_HOME/node"
  fi
fi
if [ -z "$NODE_BIN" ]; then
  install_node
fi
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "Node.js installation failed."
[ "$(node_major "$NODE_BIN")" -ge "$MAB_NODE_MIN_MAJOR" ] || die "Node.js $MAB_NODE_MIN_MAJOR+ is required, found $("$NODE_BIN" --version)."

say "Using Node.js $("$NODE_BIN" --version) ($NODE_BIN)"

NODE_NPM=""
if [ -x "$NODE_DIR/bin/npm" ]; then
  NODE_NPM="$NODE_DIR/bin/npm"
elif have npm; then
  NODE_NPM=$(command -v npm)
fi

# Download the single-file bridge.
mkdir -p "$MAB_HOME"
say "Downloading the bridge..."
download "$MAB_BRIDGE_URL" "$MAB_HOME/bridge.mjs"
[ -s "$MAB_HOME/bridge.mjs" ] || die "The bridge download was empty."

# The bridge has no required npm dependencies. This tiny optional package only
# renders the terminal pairing QR; without it, the bridge prints the payload.
if [ "$MAB_SKIP_QR" != "1" ]; then
  if [ -n "$NODE_NPM" ]; then
    say "Installing the QR renderer..."
    if ! "$NODE_NPM" install --prefix "$MAB_HOME" --no-save --no-package-lock --silent qrcode-terminal@0.12.0; then
      warn "Could not install qrcode-terminal. Pairing will print a text payload instead."
    fi
  else
    warn "npm was not found. Pairing will print a text payload instead of a QR."
  fi
fi

# Create or reuse the shared token.
token_dir=$(dirname "$MAB_TOKEN_FILE")
mkdir -p "$token_dir"
old_umask=$(umask)
umask 077
if [ ! -s "$MAB_TOKEN_FILE" ]; then
  if have openssl; then
    token=$(openssl rand -hex 32)
  else
    token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  fi
  [ -n "$token" ] || die "Could not generate a bridge token."
  printf '%s\n' "$token" > "$MAB_TOKEN_FILE"
else
  token=$(tr -d '\r\n' < "$MAB_TOKEN_FILE")
fi
chmod 600 "$MAB_TOKEN_FILE" 2>/dev/null || true
umask "$old_umask"

# Create the short command.
mkdir -p "$MAB_BIN_DIR"
WRAPPER="$MAB_BIN_DIR/mabridge"
say "Installing the mabridge command..."
cat > "$WRAPPER" <<EOF
#!/bin/sh
set -eu
MAB_NODE='$NODE_BIN'
MAB_NODE_DIR='$NODE_DIR'
MAB_BRIDGE='$MAB_HOME/bridge.mjs'
MAB_BRIDGE_URL='$MAB_BRIDGE_URL'
MAB_TOKEN_FILE='$MAB_TOKEN_FILE'

if [ ! -x "\$MAB_NODE" ]; then
  echo "mabridge: Node.js is missing at \$MAB_NODE. Re-run the installer." >&2
  exit 1
fi
if [ ! -f "\$MAB_BRIDGE" ]; then
  echo "mabridge: bridge.mjs is missing at \$MAB_BRIDGE. Re-run the installer." >&2
  exit 1
fi
if [ -n "\$MAB_NODE_DIR" ]; then
  PATH="\$MAB_NODE_DIR/bin:\$PATH"
  export PATH
fi

if [ "\${1:-}" = "--update" ]; then
  tmp="\$MAB_BRIDGE.tmp"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "\$MAB_BRIDGE_URL" -o "\$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "\$tmp" "\$MAB_BRIDGE_URL"
  else
    echo "mabridge: curl or wget is required to update." >&2
    exit 1
  fi
  mv "\$tmp" "\$MAB_BRIDGE"
  echo "Updated \$MAB_BRIDGE"
  exit 0
fi

# Default to both harnesses on the LAN. An explicit --host or --lan wins.
# Print a one-time pairing QR unless --no-pair is given.
want_lan=1
want_pair=1
for arg in "\$@"; do
  case "\$arg" in
    --host|--lan) want_lan=0 ;;
    --no-pair) want_pair=0 ;;
    --pair) want_pair=0 ;;
  esac
done
if [ "\$#" -eq 0 ]; then
  set -- --harness all
fi
if [ "\$want_lan" -eq 1 ]; then
  set -- "\$@" --lan
fi
if [ "\$want_pair" -eq 1 ]; then
  set -- "\$@" --pair
fi
exec "\$MAB_NODE" "\$MAB_BRIDGE" --token-file "\$MAB_TOKEN_FILE" "\$@"
EOF
chmod +x "$WRAPPER"

# Add the bin directory to PATH for the current shell's startup file.
if [ "$MAB_NO_PATH" != "1" ]; then
  case ":$PATH:" in
    *":$MAB_BIN_DIR:"*) ;;
    *)
      shell_name=$(basename "${SHELL:-sh}")
      case "$shell_name" in
        zsh) rc="$HOME/.zshrc" ;;
        bash) rc="$HOME/.bashrc" ;;
        *) rc="$HOME/.profile" ;;
      esac
      if [ -f "$rc" ] && grep -q '# mobile-agent bridge' "$rc"; then
        :
      else
        mkdir -p "$(dirname "$rc")"
        {
          printf '\n# mobile-agent bridge\n'
          printf 'export PATH="%s:$PATH"\n' "$MAB_BIN_DIR"
        } >> "$rc"
      fi
      say "Added $MAB_BIN_DIR to PATH in $rc."
      say "Restart your shell or run: export PATH=\"$MAB_BIN_DIR:\$PATH\""
      ;;
  esac
fi

# Resolve the address a phone on the same network should use. The bridge does
# this too, but the installer prints the manual URLs before the bridge starts.
lan_ip=$("$NODE_BIN" -e '
const os = require("node:os");
const candidates = [];
for (const addresses of Object.values(os.networkInterfaces())) {
  for (const item of addresses || []) {
    const family = String(item.family);
    if (family !== "IPv4" && family !== "4") continue;
    if (item.internal || !item.address) continue;
    candidates.push({ name: item.name || "", address: item.address });
  }
}
const isPrivate = (address) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
const preferred = candidates.filter((item) => isPrivate(item.address));
const pool = preferred.length > 0 ? preferred : candidates;
pool.sort((left, right) => {
  const rank = (item) => {
    if (/^(wlan|ap|swlan|eth|en\d|enp|eno)/i.test(item.name)) return 0;
    if (/^(tun|ppp|wg|utun|tailscale)/i.test(item.name)) return 2;
    if (/^(docker|veth|br-|virbr|vmnet)/i.test(item.name)) return 3;
    return 1;
  };
  return rank(left) - rank(right);
});
console.log(pool[0]?.address || "127.0.0.1");
' 2>/dev/null || printf '127.0.0.1')
[ -n "$lan_ip" ] || lan_ip=127.0.0.1

say ""
say "Installed."
say "  command: mabridge"
say "  bridge:  $MAB_HOME/bridge.mjs"
say "  token:   $MAB_TOKEN_FILE"
say ""
have_agy=0
have_claude=0
if have agy; then
  have_agy=1
  say "✓ Antigravity CLI: $(command -v agy)"
else
  warn "Antigravity CLI (agy) not found. Install it, then run: agy acp --login"
fi
if have claude-agent-acp; then
  have_claude=1
  say "✓ Claude ACP adapter: $(command -v claude-agent-acp)"
else
  warn "Claude ACP adapter not found. Install: npm install -g @agentclientprotocol/claude-agent-acp"
fi
say ""
if [ "$have_agy" -eq 1 ] || [ "$have_claude" -eq 1 ]; then
  say "Start your installed harnesses on the LAN and print a pairing QR:"
else
  say "No harness CLI is installed yet. Install one of the above, then start:"
fi
say "  mabridge"
say ""
say "Open Settings → Harnesses in the mobile app and scan the QR."
say "The code is single-use and expires in 5 minutes."
say "Use --no-pair to skip the QR, or add the URLs manually:"
if [ "$have_agy" -eq 1 ]; then
  say "  Antigravity: http://$lan_ip:7801"
else
  say "  Antigravity: http://$lan_ip:7801 (after installing agy)"
fi
if [ "$have_claude" -eq 1 ]; then
  say "  Claude:      http://$lan_ip:7802"
else
  say "  Claude:      http://$lan_ip:7802 (after installing claude-agent-acp)"
fi
say "  Token:       $token"
say ""
say "Update later with: mabridge --update"
