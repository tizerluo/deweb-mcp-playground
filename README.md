# DeWEB MCP playground (off-chain)

**Not an official TapeOut client. Not a TAP number.**

Companion case for the unofficial draft:

- [tizerluo/deweb-api-webmcp-draft](https://github.com/tizerluo/deweb-api-webmcp-draft)

This app is a **browser playground**. It shows how TAP-10 request/response content (`deweb.req/v0` / `deweb.res/v0`) and a WebMCP tool list (`/.tape/mcp.json`) would feel, without a mainnet send.

| Layer                                           | In this repo                                        |
| ----------------------------------------------- | --------------------------------------------------- |
| Quote (DexScreener)                             | real HTTP                                           |
| JEV decisions (TypeSafe System One)             | real HTTP if a key is set; local policy without one |
| Identity `#8801@0`, TAP-10 inbox, BEM lock      | **local simulation**                                |
| TapeKit kernel / gateway origin / inbox watcher | **not here**                                        |

English is the code and this README. UI strings: zh / en / ja / ko.

## JEV decisions

The `jev` stall (`#9104@0`, method `decide`, 0.01 BEM/call) is the only place
this playground talks to a model. **JEV does not write text**: a caller sends a
situation (`state`) plus typed questions and gets a typed answer back — a
`choice`, a `score` or a `noul`, each with calibrated probabilities and a
confidence. One call is one TAP-10 round trip between `#8801@0` and the stall.

Client → server → provider, so the key never reaches the bundle:

| Env                  | Backend                                                                                            | Model             |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` (Vercel AI Gateway, free tier — first choice) | `typesafe-ai/jev` |
| `TYPESAFE_API_KEY`   | `https://api.typesafe.ai/v1/systemone` (official direct — local dev)                               | `jev-latest`      |
| neither              | none: **degrade to a local policy**, labelled in the UI                                            | —                 |

`src/lib/jev/protocol.ts` is pure (no env, no network) and carries the wire
shapes, request validation/truncation, the token bucket, the 429 cooldown and
the response cache; `client.server.ts` is the only file that touches a key and
it redacts that key out of every error message. The local bucket defaults to
240 requests/minute with a 30-call burst — one snake round asks once per tick
(67/min at 900 ms, 171/min at 350 ms) and one car window asks once per window
(200/min at 300 ms, 150/min at 400 ms, 120/min at 500 ms), so the brief's 30/min
baseline would throttle both; `JEV_RATE_PER_MINUTE` / `JEV_RATE_BURST` set it
back if you want that baseline. Requests time out at 3 s.

The JEV stall hosts two demos (`/s/jev`), and both are the acceptance case for
the split — the code computes the facts first and JEV only chooses among options
that are already legal:

- **Snake, played.** Legality, food distance, flood-fill reachable area and dead
  ends are computed per tick; JEV picks a direction. Rounds are reproducible from
  their seed.
- **Car, driven.** A closed loop (`r = R0 + A·cos2θ + B·sin3θ`: 120 m long, 7 m
  wide, tightest bend r ≈ 8 m) with a kinematic bicycle model stepped at a fixed
  dt. Each 300–500 ms window the code senses the car (speed, signed offset, room
  to each edge, curvature under and ahead of the car) and rolls ten candidate
  actions — five steering levels × brake/throttle — forward 2 s each, scoring max
  offset, collision, distance, final speed and comfort. JEV sees the ten labels
  with those numbers and picks one; the pick is driven until the next decision
  point.

Both use the same fixed clock: ask at window start, adopt the answer at window
end. On a timeout the snake plays straight and the car holds its last action for
one window — never two, so a provider that stops answering cannot leave the car
driving blind; after that, and on any failed call, the local policy takes over
(a centred cruise) and the badge says so. A window may stretch to cover a reply
already in flight (capped at 2.6 s, shared by both demos in
`src/lib/jev/demo-clock.ts`, from the last measured latency), because
`api.typesafe.ai` takes longer than a 350 ms tick would allow; the cap keeps the
timeout path reachable instead of hanging the demo on the network. Pause and
Reset cancel the tick/window that is in flight — an answer that lands afterwards
cannot move the snake, drive the car, or write into the run Reset just dealt —
and the end-of-round button deals a fresh round instead of re-running the dead
one. Neither loop keeps React in it (`src/lib/jev/snake/loop.ts`,
`src/lib/jev/car/loop.ts`), which is what lets those lifecycle rules be tested
by hand. `score` and `noul` answers exist in the client layer; both demos use
`choice` today.

## Run

```bash
npm install
cp .env.example .env   # optional JEV key (see "JEV decisions" below)
npm run dev            # http://127.0.0.1:8080
```

`npm run build` then `npx vite preview` for a production check.

`npm test` runs both suites (scripts and src). Cases that read the authoring
sandbox's `.grok/` scaffolding skip when it is absent — as in a clean clone.

## Sandbox scaffolding

`src/lib/auth/*` is the app-builder sandbox's sign-in stack, and the router
still mounts `AuthProvider` at the root (a passthrough today). Nothing in this
playground uses the rest of it: no screen imports `SignInGate`, `UserButton`,
`RedirectToSignIn` or `useCurrentUser`, so no route is gated and no sign-in is
prompted for. The flag that would turn it on (`VITE_AUTH_ENABLED`) lives in the
sandbox's `.grok/app-env.json`, which this repo does not ship. `npm run
check:auth` is the piece worth keeping: it compares the flag a running dev
server resolved against the one the next build will.

## What it is not

- A deployed DeWEB site
- TapeKit injecting `document.modelContext`
- Mainnet operators watching inboxes for `deweb.req/v0`
- Readable names such as `jev.tape` (current TapeKit naming is `#<ID>@<cpu>` only)

Endpoints in the catalog (`#9101@0` …) are demo IDs. Discovery files `/.tape/api.json` and `/.tape/mcp.json` are shown as the draft proposes them; SPEC §7.8 currently reserves the whole `/.tape/` prefix to the gateway.

## License

MIT.
