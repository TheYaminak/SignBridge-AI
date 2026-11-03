// Command api runs the SignBridge AI HTTP server.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/signbridge-ai/backend/internal/config"
	"github.com/signbridge-ai/backend/internal/handler"
	"github.com/signbridge-ai/backend/internal/meta"
	"github.com/signbridge-ai/backend/internal/service"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if err := config.LoadDotEnv(".env"); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parseLevel(cfg.LogLevel)}))
	slog.SetDefault(logger)

	metaClient := meta.NewHTTPClient(meta.Options{
		APIKey:  cfg.Meta.APIKey,
		Model:   cfg.Meta.Model,
		BaseURL: cfg.Meta.BaseURL,
		Timeout: cfg.Meta.Timeout,
	})

	router := handler.NewRouter(handler.Options{
		Logger:         logger,
		Interpreter:    service.NewMetaInterpreter(metaClient),
		AllowedOrigins: cfg.CORSAllowedOrigins,
		RequestTimeout: cfg.RequestTimeout,
	})

	srv := &http.Server{
		Addr:              net.JoinHostPort("", cfg.Port),
		Handler:           router,
		ReadTimeout:       cfg.ReadTimeout,
		ReadHeaderTimeout: cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server starting",
			"addr", srv.Addr,
			"env", cfg.Env,
			"cors_origins", cfg.CORSAllowedOrigins,
			"meta_configured", cfg.Meta.Configured(),
		)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	logger.Info("shutdown signal received, draining connections", "timeout", cfg.ShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("server stopped")
	return nil
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
