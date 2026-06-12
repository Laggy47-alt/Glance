FROM denoland/deno:alpine-1.46.3
WORKDIR /app
COPY index.ts ./
USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "index.ts"]
