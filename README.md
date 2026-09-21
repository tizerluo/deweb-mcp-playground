# DeWEB MCP playground (off-chain)

**Not an official TapeOut client. Not a TAP number.**

Companion case for the unofficial draft:

- [tizerluo/deweb-api-webmcp-draft](https://github.com/tizerluo/deweb-api-webmcp-draft)

This app is a **browser playground**. It shows how TAP-10 request/response content (`deweb.req/v0` / `deweb.res/v0`) and a WebMCP tool list (`/.tape/mcp.json`) would feel, without a mainnet send.

| Layer | In this repo |
|---|---|
| Quote (DexScreener) | real HTTP |
| Translate / NPC (xAI) | real HTTP if `XAI_API_KEY` is set |
| Identity `#8801@0`, TAP-10 inbox, BEM lock | **local simulation** |
| TapeKit kernel / gateway origin / inbox watcher | **not here** |

English is the code and this README. UI strings: zh / en / ja / ko.

## Run

```bash
npm install
cp .env.example .env   # optional XAI_API_KEY
npm run dev            # http://127.0.0.1:8080
```

`npm run build` then `npx vite preview` for a production check.

## What it is not

- A deployed DeWEB site
- TapeKit injecting `document.modelContext`
- Mainnet operators watching inboxes for `deweb.req/v0`
- Readable names such as `translate.tape` (current TapeKit naming is `#<ID>@<cpu>` only)

Endpoints in the catalog (`#9101@0` …) are demo IDs. Discovery files `/.tape/api.json` and `/.tape/mcp.json` are shown as the draft proposes them; SPEC §7.8 currently reserves the whole `/.tape/` prefix to the gateway.

## License

MIT.
