FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.json vite.config.ts ./
COPY postcss.config.cjs tailwind.config.ts components.json ./
RUN npm install

COPY index.html ./
COPY src ./src

CMD ["npm", "run", "dev"]
