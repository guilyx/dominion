#!/bin/sh
# Dominion installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/guilyx/dominion/main/install.sh | sh
#
# Downloads the latest release build for this machine and installs it. On macOS
# it also clears the download quarantine, which is the step people otherwise
# have to do by hand because the app is not code-signed.
#
# Options (pass after `| sh -s --`, or when running the script directly):
#   --version X.Y.Z   install a specific version instead of the latest
#   --prefix DIR      where to put the Linux binary (default ~/.local/bin)
#   --dry-run         print what would be downloaded and installed, then stop
set -eu

REPO="${DOMINION_REPO:-guilyx/dominion}"   # overridable so forks and tests can point elsewhere
PREFIX="${DOMINION_PREFIX:-$HOME/.local/bin}"
VERSION="${DOMINION_VERSION:-}"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --prefix)  PREFIX="${2:?--prefix needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      # A literal string, not a read of $0: when piped from curl there is no file.
      cat <<'USAGE'
Dominion installer for macOS and Linux.

  curl -fsSL https://raw.githubusercontent.com/guilyx/dominion/main/install.sh | sh

Options (after `| sh -s --`, or when running the script directly):
  --version X.Y.Z   install a specific version instead of the latest
  --prefix DIR      where to put the Linux binary (default ~/.local/bin)
  --dry-run         print what would be downloaded and installed, then stop
  -h, --help        show this
USAGE
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have curl || die "curl is required"

# ---------------------------------------------------------------- the machine
os=$(uname -s)
arch=$(uname -m)
case "$os-$arch" in
  Darwin-arm64)        asset_suffix="mac-arm64.zip";       kind="mac" ;;
  Darwin-x86_64)       asset_suffix="mac-x64.zip";         kind="mac" ;;
  Linux-x86_64|Linux-amd64) asset_suffix="linux-x86_64.AppImage"; kind="appimage" ;;
  Linux-aarch64|Linux-arm64)
    die "no Linux arm64 build yet. Use the portable HTML file from
       https://github.com/$REPO/releases/latest — it is the whole game in one
       file and runs in any browser." ;;
  *) die "unsupported platform: $os $arch" ;;
esac

# ------------------------------------------------------------------ the version
if [ -z "$VERSION" ]; then
  # The /releases/latest URL redirects to the newest tag, which avoids the
  # GitHub API's rate limit and needs no JSON parsing. Ask for the status code
  # too, so "no releases yet" (404) is not reported as a network failure.
  resp=$(curl -sLI -o /dev/null -w '%{http_code} %{url_effective}' \
    "https://github.com/$REPO/releases/latest" 2>/dev/null) \
    || die "could not reach GitHub. Check your network connection."
  code=${resp%% *}
  tag=${resp##*/}
  case "$code" in
    200) ;;
    404) die "no published release yet (or the repository is private).
       Run it from source instead:
       git clone https://github.com/$REPO && cd baw && npm start" ;;
    *)   die "GitHub returned HTTP $code for the latest release." ;;
  esac
  case "$tag" in
    v[0-9]*) VERSION=${tag#v} ;;
    *) die "could not work out the latest version from GitHub's reply." ;;
  esac
fi

ASSET="dominion-${VERSION}-${asset_suffix}"
# Overridable so a fork, a mirror or a test can serve the files elsewhere.
BASE_URL="${DOMINION_BASE_URL:-https://github.com/$REPO/releases/download}"
URL="${BASE_URL}/v${VERSION}/${ASSET}"

say "Dominion ${VERSION} for ${os} ${arch}"
say "  from ${URL}"

if [ "$DRY_RUN" = 1 ]; then
  case "$kind" in
    mac)      say "  would install to /Applications (or ~/Applications) and clear the quarantine flag" ;;
    appimage) say "  would install to ${PREFIX}/dominion" ;;
  esac
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "  downloading…"
curl -fsSL --retry 3 -o "$tmp/$ASSET" "$URL" \
  || die "download failed. Check that $ASSET exists at
       https://github.com/$REPO/releases/tag/v${VERSION}"

case "$kind" in
  mac)
    have unzip || die "unzip is required"
    unzip -q "$tmp/$ASSET" -d "$tmp/app"
    [ -d "$tmp/app/Dominion.app" ] || die "the archive did not contain Dominion.app"
    dest=/Applications
    # Fall back to the per-user folder rather than silently asking for a password.
    [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
    rm -rf "$dest/Dominion.app"
    mv "$tmp/app/Dominion.app" "$dest/"
    # The app is not code-signed, so macOS would otherwise refuse the first launch.
    xattr -dr com.apple.quarantine "$dest/Dominion.app" 2>/dev/null || true
    say "Installed to $dest/Dominion.app"
    say "Launch it from Finder, or:  open -a Dominion"
    ;;
  appimage)
    mkdir -p "$PREFIX"
    install -m 755 "$tmp/$ASSET" "$PREFIX/dominion"
    # A desktop entry so it shows up in the application menu too.
    apps="$HOME/.local/share/applications"
    mkdir -p "$apps"
    cat > "$apps/dominion.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Dominion
Comment=A browser god game
Exec=$PREFIX/dominion
Terminal=false
Categories=Game;
EOF
    say "Installed to $PREFIX/dominion"
    case ":$PATH:" in
      *":$PREFIX:"*) say "Launch it with:  dominion" ;;
      *) say "Launch it with:  $PREFIX/dominion"
         say "(add $PREFIX to your PATH to just type 'dominion')" ;;
    esac
    ;;
esac
