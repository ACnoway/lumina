# syntax=docker/dockerfile:1

FROM nginx:1.27-alpine

RUN mkdir -p /etc/nginx/snippets
COPY nginx/http.conf /etc/nginx/conf.d/default.conf
COPY nginx/proxy-locations.conf /etc/nginx/snippets/lumina-proxy-locations.conf
COPY nginx/https.conf /etc/nginx/https.conf
COPY nginx/http-redirect.conf /etc/nginx/http-redirect.conf
COPY nginx/10-enable-https.sh /docker-entrypoint.d/10-enable-https.sh
RUN chmod +x /docker-entrypoint.d/10-enable-https.sh
