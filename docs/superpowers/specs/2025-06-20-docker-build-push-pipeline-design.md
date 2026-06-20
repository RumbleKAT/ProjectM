# Docker Build & Push Pipeline to Docker Hub

## Overview

GitHub Actions workflow to automatically build and push Docker images to Docker Hub when a git tag is pushed to the master branch.

## Trigger

- **Event:** `push: tags`
- **Tag pattern:** `v*` (e.g., `v1.2.3`, `v2.0.0-rc1`)
- Tags must follow SemVer-like naming to trigger the pipeline.

## Build Configuration

| Option | Value |
|--------|-------|
| Platform | `linux/amd64` |
| Dockerfile | `docker/Dockerfile` |
| Context | repository root (`.` |
| Build arg | `TARGETARCH=amd64` |

## Image Tags

Each tag push produces three Docker image tags pushed to Docker Hub:

1. `RumbleKAT/project-m:{tag_name}` — e.g., `RumbleKAT/project-m:v1.2.3`
2. `RumbleKAT/project-m:latest` — always points to the most recently built tag
3. `RumbleKAT/project-m:{sha}` — the 7-character commit SHA for traceability

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `DOCKER_USERNAME` | Docker Hub account username |
| `DOCKER_PASSWORD` | Docker Hub access token or password |

These must be configured in the repository Settings > Secrets and variables > Actions before the workflow can run.

## Workflow Steps

1. **Checkout** — `actions/checkout@v4`
2. **Docker metadata** — `docker/metadata-action@v5` to generate tags from git ref
3. **Login to Docker Hub** — `docker/login-action@v3` using `secrets.DOCKER_USERNAME` and `secrets.DOCKER_PASSWORD`
4. **Build and push** — `docker/build-push-action@v6`
   - `context: .`
   - `file: docker/Dockerfile`
   - `platforms: linux/amd64`
   - `push: true`
   - `tags: RumbleKAT/project-m:{tag}, RumbleKAT/project-m:latest, RumbleKAT/project-m:{sha}`
   - `build-args: TARGETARCH=amd64`
5. **Commit status** — GitHub Actions automatically reports success/failure on the commit via check-run. No additional step needed.

## Notification

- **Success/failure:** Visible as GitHub check-run on the tagged commit.
- No external notification service (Slack/email) is configured.

## File to Create

`.github/workflows/docker.yml`

## Out of Scope

- Multi-platform builds (arm64) — can be added later
- PR build validation — only tag pushes trigger builds
- Automated SemVer bumping — tags are created manually
- Slack/email notifications
