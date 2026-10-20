# Dockerfile
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html style.css script.js config.js /usr/share/nginx/html/

# Generates config.js from the API_BASE env var on container start
COPY --chmod=755 docker/40-radiowave-config.sh /docker-entrypoint.d/40-radiowave-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
