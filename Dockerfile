FROM node:14.20
WORKDIR /app
COPY package.json /app
RUN yarn install
COPY . /app
RUN yarn run build
CMD yarn start
EXPOSE 8087