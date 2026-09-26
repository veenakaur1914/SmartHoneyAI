#!/bin/sh

assert_isolated_wordpress_target() {
  target="${1%/}"
  if [ "$target" != "http://wordpress" ]; then
    printf 'Local synthetic WordPress helper refuses non-isolated target: %s\n' "$1" >&2
    return 2
  fi
}

assert_isolated_wordpress_site_url() {
  target="${1%/}"
  case "$target" in
    http://localhost) return 0 ;;
    http://localhost:*)
      port="${target#http://localhost:}"
      case "$port" in *[!0-9]*|'') ;; *) return 0 ;; esac
      ;;
  esac
  printf 'Local WordPress provisioning refuses non-local site URL: %s\n' "$1" >&2
  return 2
}
