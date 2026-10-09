# syntax=docker/dockerfile:1
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/sweeptracker ./cmd/sweeptracker

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/sweeptracker /sweeptracker
ENV SWEEP_ADDR=:8080 SWEEP_TILE_DIR=/data/tiles
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/sweeptracker"]
CMD ["serve"]
