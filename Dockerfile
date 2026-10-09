# syntax=docker/dockerfile:1

# The frontend is plain files, so it is built once on the build machine whatever the target.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Go cross-compiles, so the target architecture needs no emulation.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/sweeptracker ./cmd/sweeptracker
# The image has no shell, so the data directory is made here and handed to the non-root user:
# otherwise a new volume is root-owned and map downloads fail with "permission denied".
RUN mkdir -p /out/data/tiles

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/sweeptracker /sweeptracker
COPY --from=build --chown=nonroot:nonroot /out/data /data
ENV SWEEP_ADDR=:8080 SWEEP_TILE_DIR=/data/tiles
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["/sweeptracker", "healthcheck"]
ENTRYPOINT ["/sweeptracker"]
CMD ["serve"]
