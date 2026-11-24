FROM nginx:1.27-alpine

# Storefront and admin dashboard (single static page).
COPY index.html /usr/share/nginx/html/

# Reverse-proxy configuration as a template. At start-up the official nginx entrypoint
# replaces ${NGINX_RESOLVER} and ${API_DOMAIN_SUFFIX} and writes conf.d/default.conf.
# The defaults suit Docker Compose; Kubernetes overrides both (see kubernetes/).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_RESOLVER=127.0.0.11 \
    API_DOMAIN_SUFFIX="" \
    NGINX_ENVSUBST_FILTER="^(NGINX_RESOLVER|API_DOMAIN_SUFFIX)$"

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
