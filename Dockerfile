FROM node:24.22.1-alpine
RUN apk upgrade --no-cache

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8023

CMD ["node", "api.js"]
