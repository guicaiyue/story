FROM nginx:alpine

# Custom nginx static serving configuration (gzip / asset caching).
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Static site files.
COPY . /usr/share/nginx/html

EXPOSE 80
