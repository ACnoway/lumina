#!/bin/sh
set -eu

if [ "${ENABLE_HTTPS:-false}" != "true" ]; then
  exit 0
fi

if [ ! -s /etc/nginx/certs/fullchain.pem ] || [ ! -s /etc/nginx/certs/privkey.pem ]; then
  echo "ENABLE_HTTPS=true requires fullchain.pem and privkey.pem in /etc/nginx/certs" >&2
  exit 1
fi

https_port="${HTTPS_PORT:-443}"
case "$https_port" in
  ''|*[!0-9]*)
    echo "HTTPS_PORT must be a number between 1 and 65535" >&2
    exit 1
    ;;
esac
if [ "$https_port" -lt 1 ] || [ "$https_port" -gt 65535 ]; then
  echo "HTTPS_PORT must be a number between 1 and 65535" >&2
  exit 1
fi

cp /etc/nginx/https.conf /etc/nginx/conf.d/https.conf
sed "s/__HTTPS_PORT__/$https_port/g" \
  /etc/nginx/http-redirect.conf > /etc/nginx/conf.d/default.conf
