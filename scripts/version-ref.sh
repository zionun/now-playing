# Which version install.sh and update.sh put in place. Sourced by both.
#
#   (no option)         the latest released version (highest vX.Y.Z tag,
#                       release candidates such as v1.0.0-rc.1 excluded)
#   --main              the latest commit on main, released or not
#   --version vX.Y.Z    a specific version (also older: a rollback)
#
# parse_version_args reads the options; resolve_target fetches from GitHub
# and sets TARGET_REF and TARGET_LABEL (or prints why it can't); checkout_target moves the repository
# in the current directory to TARGET_REF.

version_usage() {
    echo "Options:"
    echo "  (none)             latest released version"
    echo "  --main             latest commit on main, even if not released yet"
    echo "  --version vX.Y.Z   a specific version"
    echo "  --force            (update.sh) reinstall even if already on that version"
}

parse_version_args() {
    TARGET_MODE=release
    TARGET_VERSION=""
    FORCE=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --main) TARGET_MODE=main ;;
            --version)
                [ $# -ge 2 ] || { echo "❌ --version needs a version, e.g. --version v1.0.0"; exit 1; }
                TARGET_MODE=version
                TARGET_VERSION="v${2#v}"
                shift
                ;;
            --force) FORCE=1 ;;
            -h | --help) version_usage; exit 0 ;;
            *) echo "❌ Unknown option: $1"; version_usage; exit 1 ;;
        esac
        shift
    done
}

# Version of the code in the current directory: its tag, or tag+commits
current_version() {
    git describe --tags --match 'v[0-9]*' 2>/dev/null || git rev-parse --short HEAD
}

resolve_target() {
    git fetch --force --tags origin main ||
        { echo "❌ Could not get the versions from GitHub: check the network"; return 1; }
    local ref
    case "$TARGET_MODE" in
        main)
            ref=origin/main
            TARGET_LABEL="main ($(git rev-parse --short origin/main))"
            ;;
        version)
            git rev-parse -q --verify "refs/tags/$TARGET_VERSION" >/dev/null ||
                { echo "❌ Version $TARGET_VERSION not found"; return 1; }
            ref="$TARGET_VERSION"
            TARGET_LABEL="$TARGET_VERSION"
            ;;
        *)
            ref=$(git tag -l 'v[0-9]*' --sort=-v:refname | grep -v -- '-' | head -1)
            [ -n "$ref" ] || { echo "❌ No released version found (use --main for the latest commit)"; return 1; }
            TARGET_LABEL="$ref (latest release)"
            ;;
    esac
    TARGET_REF=$(git rev-parse "$ref^{commit}")
}

# Stays on the local main branch, moved to the chosen version
checkout_target() {
    git checkout -q -f -B main "$TARGET_REF"
}
