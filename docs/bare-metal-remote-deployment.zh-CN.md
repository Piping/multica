# Multica 裸机后端与 Cloudflare 前端部署

本文记录 `multica.diff.host` 的当前部署方式。生产环境没有 Node.js 或
Next.js 运行时：

- `ten` 只运行 Go backend 和 Cloudflare Tunnel。
- Web 使用 Vite 在本地或 CI 构建，`apps/web/dist` 由 Cloudflare Pages 托管。
- `multica.diff.host/*` 由 Cloudflare Worker 接入。`/api`、后端 `/auth`、
  `/uploads` 和 `/ws` 转发到 Go origin，其余请求转发到 Pages。
- `/auth/callback` 和 `/auth/hg-sso/callback` 是 SPA 路由，不转发到 backend。
- PostgreSQL 继续使用 Aiven，不在本次部署中迁移。

## 1. 当前布局

| 项目 | 当前值 |
| --- | --- |
| SSH 目标 | `ten` |
| 远端根目录 | `/data00/multica` |
| Release 目录 | `/data00/multica/releases/<git-commit>` |
| 当前版本软链 | `/data00/multica/current` |
| 共享配置 | `/data00/multica/shared/multica.env` |
| 上传目录 | `/data00/multica/shared/data/uploads` |
| Backend 端口 | `18080` |
| Backend systemd | `multica-backend.service` |
| Pages 项目 | `multica-web` |
| Worker | `multica-web` |
| 公网地址 | `https://multica.diff.host` |
| Backend origin | `https://multica-origin.diff.host` |

远端 release 只包含 Go 服务需要的源码和二进制：

```text
/data00/multica/
├── current -> releases/<git-commit>
├── releases/
│   └── <git-commit>/
│       └── server/bin/
│           ├── server
│           └── migrate
└── shared/
    ├── multica.env
    └── data/uploads/
```

## 2. 部署原则

1. 不要在 `ten` 上安装 pnpm workspace、运行 `vite build` 或运行任何
   Node/Next 服务。
2. Go 和 Web 产物都在本地或 CI 构建。
3. 构建、同步和发布必须基于同一个 Git commit，先提交再部署。
4. Aiven URL、JWT 密钥和 Cloudflare token 不进入 Git 或 release。
5. Backend origin 只供 Worker 回源；浏览器统一访问
   `https://multica.diff.host`。
6. 保留上一个 backend release，确认新版本稳定后再清理。

## 3. 远端首次配置

创建目录和运行用户：

```bash
ssh ten '
  set -e
  id multica >/dev/null 2>&1 ||
    useradd --system \
      --home-dir /data00/multica/shared \
      --shell /usr/sbin/nologin \
      multica
  install -d -m 755 /data00/multica/releases
  install -d -m 755 -o multica -g multica /data00/multica/shared
  install -d -m 755 -o multica -g multica \
    /data00/multica/shared/data/uploads
'
```

手动创建 `/data00/multica/shared/multica.env`：

```dotenv
DATABASE_URL='postgres://<AIVEN_USER>:<URL_ENCODED_PASSWORD>@<AIVEN_HOST>:<PORT>/<DATABASE>?sslmode=require'
JWT_SECRET='<openssl-rand-hex-32-output>'

APP_ENV=production
PORT=18080
FRONTEND_ORIGIN=https://multica.diff.host
MULTICA_APP_URL=https://multica.diff.host
MULTICA_PUBLIC_URL=https://multica.diff.host
CORS_ALLOWED_ORIGINS=https://multica.diff.host,wails://localhost,http://wails.localhost
COOKIE_DOMAIN=

LOCAL_UPLOAD_DIR=/data00/multica/shared/data/uploads
LOCAL_UPLOAD_BASE_URL=https://multica.diff.host

ALLOW_SIGNUP=false
MULTICA_DEV_VERIFICATION_CODE=
```

`wails://localhost` 是 macOS/Linux Wails v3 renderer 的固定 origin，
`http://wails.localhost` 是 Windows 的固定 origin。它们只代表本机打包资源，
不是可被远程访问的 HTTP 服务。后端也会把这两个 origin 固定追加到 CORS 和
WebSocket 白名单，避免部署时只配置 Web 域名导致 Desktop 登录显示
`Load failed`。

```bash
ssh ten '
  chown root:multica /data00/multica/shared/multica.env
  chmod 640 /data00/multica/shared/multica.env
'
```

`/etc/systemd/system/multica-backend.service`：

```ini
[Unit]
Description=Multica Go backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=multica
Group=multica
WorkingDirectory=/data00/multica/current
EnvironmentFile=/data00/multica/shared/multica.env
Environment=HOME=/data00/multica/shared
ExecStart=/data00/multica/current/server/bin/server
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/data00/multica/shared

[Install]
WantedBy=multi-user.target
```

```bash
ssh ten '
  systemctl daemon-reload
  systemctl enable multica-backend.service
'
```

不要创建 `multica-web.service`。如果旧单元仍存在，清理它：

```bash
ssh ten '
  systemctl disable --now multica-web.service 2>/dev/null || true
  rm -f /etc/systemd/system/multica-web.service
  systemctl daemon-reload
'
```

## 4. Backend 更新

以下命令从仓库根目录执行：

```bash
set -euo pipefail

REMOTE=ten
ROOT=/data00/multica
REV=$(git rev-parse HEAD)
RELEASE="$ROOT/releases/$REV"
BUILD_ROOT="$(dirname "$PWD")/.multica-build-$REV"
ARTIFACT_DIR="$PWD/.artifacts/$REV"

test -z "$(git status --porcelain)" ||
  echo "警告：只有已提交的 $REV 会进入 release"

rm -rf "$BUILD_ROOT" "$ARTIFACT_DIR"
mkdir -p "$BUILD_ROOT" "$ARTIFACT_DIR/server/bin"
git archive "$REV" | tar -x -C "$BUILD_ROOT"
```

本地交叉编译 Linux amd64 二进制：

```bash
(
  cd "$BUILD_ROOT/server"
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags '-s -w' \
    -o "$ARTIFACT_DIR/server/bin/server" ./cmd/server
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags '-s -w' \
    -o "$ARTIFACT_DIR/server/bin/migrate" ./cmd/migrate
)

file "$ARTIFACT_DIR/server/bin/server" \
  "$ARTIFACT_DIR/server/bin/migrate"
```

同步 Git 快照和二进制到 `/data00/multica`：

```bash
ssh "$REMOTE" "
  set -e
  test ! -e '$RELEASE'
  install -d -m 755 '$RELEASE'
"

git archive "$REV" |
  ssh "$REMOTE" "tar -x -C '$RELEASE'"

scp "$ARTIFACT_DIR/server/bin/server" \
  "$ARTIFACT_DIR/server/bin/migrate" \
  "$REMOTE:$RELEASE/server/bin/"

ssh "$REMOTE" "
  set -e
  chmod 755 '$RELEASE/server/bin/server' '$RELEASE/server/bin/migrate'
  runuser -u multica -- bash -c '
    set -a
    source /data00/multica/shared/multica.env
    set +a
    cd \"$RELEASE\"
    ./server/bin/migrate up
  '
  ln -sfn '$RELEASE' '$ROOT/current'
  systemctl restart multica-backend.service
  systemctl is-active multica-backend.service
  curl -fsS http://127.0.0.1:18080/api/config >/dev/null
"
```

## 5. Web 构建和 Cloudflare 发布

Web 构建必须在本地或 CI 完成：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build

test -f apps/web/dist/index.html
test -d apps/web/dist/assets
```

首次使用 Wrangler 时，在本地完成登录，或在 CI 中提供受限的
`CLOUDFLARE_API_TOKEN`。不要将 token 写入 `wrangler.jsonc`。

按顺序发布 Pages 和 Worker：

```bash
pnpm -C apps/web exec wrangler pages deploy dist \
  --project-name multica-web \
  --branch main

pnpm -C apps/web exec wrangler deploy
```

也可以使用等价的一体化命令：

```bash
pnpm -C apps/web deploy
```

当前 Worker 配置在 `apps/web/wrangler.jsonc`：

```text
MULTICA_ORIGIN_URL=https://multica-origin.diff.host
STATIC_ORIGIN_URL=https://multica-web.pages.dev
route=multica.diff.host/*
```

## 6. Cloudflare Tunnel

Tunnel 只暴露独立 backend origin，不承载静态页面。配置示例：

```yaml
ingress:
  - hostname: multica-origin.diff.host
    service: http://127.0.0.1:18080
  - service: http_status:404
```

应用配置：

```bash
ssh ten '
  cloudflared --config /etc/cloudflared/config.yml \
    tunnel ingress validate
  systemctl restart cloudflared
  systemctl is-active cloudflared
'
```

不要再为 `multica.diff.host` 或 `agent.diff.host` 配置 Tunnel ingress。
`multica.diff.host/*` 由 Worker zone route 接管。

## 7. 发布验证

检查远端只有 Go backend，没有 Web/Node listener：

```bash
ssh ten '
  set -e
  systemctl is-active multica-backend cloudflared
  test ! -e /etc/systemd/system/multica-web.service
  ss -ltnp | grep ":18080[[:space:]]"
  ! ss -ltnp | grep -E ":(13000|3000)[[:space:]]"
  curl -fsS http://127.0.0.1:18080/api/config >/dev/null
'
```

检查 Pages、Worker 和同域分流：

```bash
curl -fsS https://multica-web.pages.dev/ >/dev/null
curl -fsS https://multica.diff.host/ >/dev/null
curl -fsS https://multica.diff.host/login >/dev/null
curl -fsS https://multica.diff.host/api/config >/dev/null

curl -sS -o /dev/null -w '%{http_code}\n' \
  https://multica.diff.host/api/me
curl -sSI https://multica.diff.host/assets/<hashed-asset-name>.js |
  grep -i 'cache-control:.*immutable'
```

未登录的 `/api/me` 应返回 `401`。`/` 和 `/login` 应引用 Vite 生成的
`/assets/*` 文件。

## 8. 回滚

Backend 回滚：

```bash
PREVIOUS_COMMIT='<previous-git-commit>'
ssh ten "
  set -e
  PREVIOUS='/data00/multica/releases/$PREVIOUS_COMMIT'
  test -x \"\$PREVIOUS/server/bin/server\"
  ln -sfn \"\$PREVIOUS\" /data00/multica/current
  systemctl restart multica-backend.service
  systemctl is-active multica-backend.service
"
```

应用回滚不会自动回滚 Aiven schema。不要在未审查 down migration 和数据
影响时执行 `migrate down`。

Web 可以在 Cloudflare Pages 的 deployment history 中将上一个 main
deployment 重新设为 production；Worker 可用 Wrangler 的版本/部署历史回滚。

## 9. 发布检查清单

- [ ] 目标 Git commit 已提交并推送。
- [ ] Go 二进制为 Linux x86-64，并已同步到 `/data00/multica`。
- [ ] Aiven `migrate up` 成功。
- [ ] `ten` 上只有 backend 和 cloudflared，无 Node/Next/Web service。
- [ ] Vite `typecheck`、测试和 production build 通过。
- [ ] `dist/index.html` 和 `dist/assets` 存在。
- [ ] Pages 发布成功，Worker 发布成功。
- [ ] `/`、`/login`、静态资源和 `/api/config` 验证通过。
- [ ] `/api/me` 在未登录状态返回 `401`。
- [ ] `multica.env` 和 Cloudflare token 未进入 Git。
