.PHONY: setup dev backend frontend test fmt lint typecheck build check

setup:
	npm install
	npm --prefix frontend install
	cd backend && go mod download

dev:
	npm run dev

backend:
	cd backend && go run ./cmd/api

frontend:
	npm --prefix frontend run dev

test:
	cd backend && go test ./...

fmt:
	cd backend && gofmt -w .

lint:
	cd backend && go vet ./...
	npm --prefix frontend run lint

typecheck:
	npm --prefix frontend run typecheck

build:
	cd backend && go build -o bin/api ./cmd/api
	npm --prefix frontend run build

check: lint typecheck test build
