FROM nginx:latest

COPY dist/ps-encrypt/browser/ /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

