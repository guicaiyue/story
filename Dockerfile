ARG BASE_IMAGE=nginx:alpine
FROM ${BASE_IMAGE}

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html

EXPOSE 80
