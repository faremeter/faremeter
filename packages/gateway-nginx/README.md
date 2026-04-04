# @faremeter/gateway-nginx

Generate OpenResty (nginx + Lua) configuration from OpenAPI specs with `x-faremeter-*` pricing extensions.

## Installation

```bash
pnpm install @faremeter/gateway-nginx
```

## Features

- Config generation - Produce nginx.conf and Lua from an OpenAPI spec
- Three transports - HTTP JSON, SSE streaming, and WebSocket frame relay
- Static analysis - Extract only the response fields capture expressions need
- Spec-compliant SSE - Multi-line data field accumulation per the SSE specification
- Method dispatch - Multiple HTTP methods on the same path with different pricing

## API Reference

<!-- TSDOC_START -->

## Functions

- [generateConfig](#generateconfig)

### generateConfig

| Function         | Type                                         |
| ---------------- | -------------------------------------------- |
| `generateConfig` | `(input: GeneratorInput) => GeneratorOutput` |

<!-- TSDOC_END -->
