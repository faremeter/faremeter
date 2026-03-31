# @faremeter/gateway-nginx

Generate OpenResty (nginx + Lua) configuration from OpenAPI specs with `x-faremeter-*` pricing extensions. The generated config intercepts HTTP traffic, enforces payment via a sidecar process, and captures response data for settlement.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full gateway architecture, nginx phase model, sidecar protocol, and shared-state reference.

## Installation

```bash
pnpm install @faremeter/gateway-nginx
```

## Prerequisites

The generated configuration requires [OpenResty](https://openresty.org/) (nginx with LuaJIT) and the [lua-resty-http](https://github.com/ledgetech/lua-resty-http) module.

```bash
# macOS
brew install openresty/brew/openresty
opm install ledgetech/lua-resty-http

# Debian/Ubuntu
# See https://openresty.org/en/linux-packages.html
```

## Features

- Config generation - Produce nginx location blocks and a Lua module from an OpenAPI spec
- Three transports - HTTP JSON, SSE streaming, and WebSocket frame relay
- Static analysis - Extract only the response fields that capture expressions reference
- Search-key optimization - Skip parsing response chunks that cannot contain relevant fields
- Method dispatch - Multiple HTTP methods on the same path with different pricing rules
- Spec endpoint - Optionally serve the OpenAPI spec at `/.well-known/openapi.yaml`

## API Reference

<!-- TSDOC_START -->

## Functions

- [generateConfig](#generateconfig)

### generateConfig

Generate nginx location blocks and a bundled Lua module for a set
of parsed routes. Produces:

- `locationsConf` — the location block text. The operator
  includes this inside their own `server { }` block via
  `include locations.conf;`.

- `luaFiles` — standalone Lua modules that the generated
  config will `require()` at runtime. The operator places
  these in their `lua_package_path`. Currently produces a
  single `faremeter.lua` bundle.

- `warnings` — non-fatal concerns detected at generation time.

Pure function: does no I/O, no network calls, no filesystem
access. Safe to call in tests.

| Function         | Type                                         |
| ---------------- | -------------------------------------------- |
| `generateConfig` | `(input: GeneratorInput) => GeneratorOutput` |

<!-- TSDOC_END -->
