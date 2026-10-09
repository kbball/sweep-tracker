package main

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthcheck(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/healthz" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
	defer srv.Close()
	addr := strings.TrimPrefix(srv.URL, "http://")
	ctx := context.Background()
	var out bytes.Buffer

	if err := run(ctx, []string{"healthcheck"}, envMap(map[string]string{"SWEEP_ADDR": addr}), &out); err != nil {
		t.Fatalf("healthy server: %v", err)
	}
	// A wildcard listen address is checked on loopback.
	_, port, _ := strings.Cut(addr, ":")
	for _, a := range []string{":" + port, "0.0.0.0:" + port, "[::]:" + port} {
		if err := healthcheck(ctx, envMap(map[string]string{"SWEEP_ADDR": a})); err != nil {
			t.Fatalf("%s: %v", a, err)
		}
	}
	status = http.StatusServiceUnavailable
	if err := healthcheck(ctx, envMap(map[string]string{"SWEEP_ADDR": addr})); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("unhealthy server must fail: %v", err)
	}
	if err := healthcheck(ctx, envMap(map[string]string{"SWEEP_ADDR": "127.0.0.1:1"})); err == nil {
		t.Fatal("nothing listening must fail")
	}
	if err := healthcheck(ctx, envMap(map[string]string{"SWEEP_ADDR": "not an address"})); err == nil {
		t.Fatal("a bad address must fail")
	}
	if err := healthcheck(ctx, envMap(map[string]string{"SWEEP_ADDR": "[::1"})); err == nil {
		t.Fatal("a malformed address must fail")
	}
	if err := healthcheck(cancelledCtx(), envMap(map[string]string{"SWEEP_ADDR": addr})); err == nil {
		t.Fatal("a cancelled check must fail")
	}
}

// With no SWEEP_ADDR the check uses the default port (:8080).
func TestHealthcheckDefaultsToPort8080(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:8080")
	if err != nil {
		t.Skip("port 8080 is in use on this machine")
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })}
	go srv.Serve(l) //nolint:errcheck
	defer srv.Close()
	if err := healthcheck(context.Background(), envMap(nil)); err != nil {
		t.Fatal(err)
	}
}

// cancelledCtx is already cancelled, so a request made with it cannot succeed.
func cancelledCtx() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}
