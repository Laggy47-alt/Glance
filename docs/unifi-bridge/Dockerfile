FROM denoland/deno:alpine-1.46.3
WORKDIR /app
COPY index.ts ./
RUN deno cache --no-check index.ts || true
ENV DENO_DIR=/app/.deno
USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "index.ts"]
