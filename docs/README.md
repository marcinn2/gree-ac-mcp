# Deployment examples

Example deployment manifests for `gree-ac-mcp-server` in **HTTP transport** mode.

> ⚠️ **The networking caveat that matters most.** GREE units are discovered and
> controlled over **UDP on the local network** (broadcast scan to `255.255.255.0/24`-style
> `255.255.255.255:7000`, then unicast). Containers on a NAT/overlay network generally
> **cannot** reach them. Both examples therefore use **host networking** and assume the
> host/node is on the same L2 LAN as the air conditioners. If you give every device an
> explicit `address` in config, broadcast discovery isn't needed, but unicast UDP/7000 must
> still be routable both ways.

## Docker Compose

[`docker-compose.yml`](./docker-compose.yml)

```bash
cd docs
cp ../config.example.json ../config.json   # then edit: bearerToken + your devices
docker compose up -d --build
curl http://localhost:8080/healthz
```

- Uses `network_mode: host` for LAN UDP discovery (the `ports:` mapping is then ignored).
- Mounts the repo-root `../config.json` read-only at `/config/config.json`.
- Health check hits the unauthenticated `/healthz`; Docker log rotation is capped (logs
  contain device MAC/IP identifiers).

## Building the image (multi-arch: amd64 + arm64)

The base image is multi-arch and the project has no native dependencies, so one `buildx`
command produces both architectures. A multi-arch manifest **must be pushed** to a registry
(it can't be `--load`ed into the local store).

```bash
# one-time setup
docker buildx create --name multiarch --use
# only for emulated cross-builds (e.g. arm64 on an amd64 host):
docker run --privileged --rm tonistiigi/binfmt --install all

# build BOTH arches and push
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t registry.example.com/gree-ac-mcp-server:1.0.0 \
  -t registry.example.com/gree-ac-mcp-server:latest \
  --push ..

# (optional) single arch locally for testing — can use --load
docker buildx build --platform linux/arm64 -t gree-ac-mcp-server:test --load ..

# verify both platforms are in the manifest
docker buildx imagetools inspect registry.example.com/gree-ac-mcp-server:1.0.0
```

> Paths use `..` because these commands are run from the `docs/` folder; the build context is
> the repo root. The same guidance is repeated as a comment block at the top of the `Dockerfile`.

## Kubernetes

[`k8s/`](./k8s/) — apply with Kustomize:

```bash
# 1. Build & push the image (multi-arch — see the section above):
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.example.com/gree-ac-mcp-server:1.0.0 --push ..
#    (then set it via the `images:` block in k8s/kustomization.yaml)

# 2. Label a node that sits on the AC's LAN:
kubectl label node <node-on-ac-lan> gree-ac/lan=true

# 3. Put your real config in the Secret. Either edit k8s/secret.yaml, or:
kubectl create namespace gree-ac
kubectl -n gree-ac create secret generic gree-ac-config --from-file=config.json=../config.json

# 4. Apply:
kubectl apply -k k8s/
```

| File | Purpose |
|------|---------|
| `namespace.yaml` | `gree-ac` namespace. |
| `secret.yaml` | Holds `config.json` (contains the bearer token — **keep it out of git**). |
| `deployment.yaml` | 1 replica, `hostNetwork`, non-root, read-only rootfs, `/healthz` probes, resource limits. |
| `service.yaml` | ClusterIP on port 8080. |
| `ingress.yaml` | Optional HTTPS/TLS exposure (ingress-nginx; SSE buffering disabled). |
| `kustomization.yaml` | Ties the above together; pin the image here. |

### Notes

- **`replicas: 1` on purpose.** Each pod independently binds/polls the devices and keeps MCP
  session state in memory, so scaling out causes duplicate UDP traffic and broken sessions.
- **`hostNetwork: true` + `nodeSelector`** pin the pod to a LAN-connected node. Without LAN
  reachability the devices will show as `unbound` in `/healthz`.
- **TLS:** the app speaks plaintext HTTP and relies on the bearer token. Put it behind the
  `ingress.yaml` (or any TLS-terminating proxy) for anything beyond a trusted LAN.
- **Probes** use the unauthenticated `/healthz` endpoint; `200` reflects process liveness and
  reports bound/unbound device counts.
