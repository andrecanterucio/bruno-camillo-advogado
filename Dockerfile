# Painel e site do advogado. Sem dependências: só Node 22+ (node:sqlite).
FROM node:24-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY . .
RUN groupadd -r app && useradd -r -g app app && mkdir -p /app/data && chown -R app:app /app/data
USER app
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
