# Connect an MCP client

How to point an MCP client at the Royal Construction operations agent. For what
the endpoint does once you are connected — the four tools, the polling
contract, the limits — see [the endpoint
contract](./eve-mcp-endpoint.md).

## Before you start

- The endpoint is `https://<host>/eve/v1/mcp`. Use the deployment's real host;
  there is no separate MCP domain.
- You need a **Royal Construction account**. Signing in to Clerk is not
  enough — a Clerk account with no application user is refused with
  `agent_access_denied`, and only somebody with admin access can fix that.
- The agent must be switched on for that environment
  (`EVE_OPERATIONS_AGENT_ENABLED=true`). If it is not, every request comes back
  `agent_disabled`.

You do not need an API key, a client ID or a client secret. The sign-in is
interactive: the client registers itself with Clerk the first time it connects,
opens a browser, and you approve it there.

## Claude Code

```bash
claude mcp add --transport http royal-construction https://<host>/eve/v1/mcp
```

Then run `/mcp` inside Claude Code and authenticate. A browser opens on Clerk's
sign-in page; approve the `profile` and `email` scopes and the status turns to
connected.

## Claude Desktop, ChatGPT, Grok and other hosted clients

Add a **remote** or **custom** connector and give it the URL
`https://<host>/eve/v1/mcp`. Leave any API-key field blank — the client will
discover that the server wants OAuth, register itself, and send you to Clerk to
sign in.

## A client you are writing yourself

Use an MCP SDK with Streamable HTTP and OAuth support rather than hand-rolling
the flow. If you are doing it by hand:

1. `POST` to the endpoint with no credential. You get `401` and a
   `WWW-Authenticate: Bearer` header containing `resource_metadata="..."`.
2. `GET` that URL. It returns the protected-resource metadata naming Clerk as
   the authorization server.
3. `GET` `<issuer>/.well-known/oauth-authorization-server` for Clerk's
   endpoints, including `registration_endpoint`.
4. Register through [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591), run the
   authorization-code flow with PKCE (`S256`), and ask for `profile email`.
5. Send the access token as `Authorization: Bearer <token>` on every request.

Follow the `resource_metadata` URL from the challenge rather than building the
well-known path yourself. The document is served at
`/eve/v1/mcp/.well-known/oauth-protected-resource`, because only `/eve/v1/*` is
routed to the agent; the canonical RFC 9728 path redirects there, but the
challenge is the reliable route.

## Checking it worked

Ask it something read-only first:

> What leads are open at the moment?

The client calls `agent_start`, gets an invocation ID back straight away, and
polls `agent_get` until the answer arrives. A write — sending a follow-up,
moving a schedule — will usually come back as `input_required` first, asking
you to approve the exact change. That is the approval flow, not an error.

## When it does not work

| What you see | What it means |
| --- | --- |
| `401` with no `resource_metadata` | The deployment was built without a Clerk publishable key, so discovery was never published. Rebuild with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set |
| `403 agent_disabled` | `EVE_OPERATIONS_AGENT_ENABLED` is not `"true"` for that environment |
| `403 agent_access_denied` | The Clerk account signed in has no Royal Construction user record |
| Registration fails before you reach a sign-in page | The client could not register with Clerk. Check the issuer in the metadata is the Clerk instance you expect |
| `not_found` on an invocation you started | Invocations belong to the account that started them. A different sign-in cannot read, answer or cancel them |

Do not retry a failed `agent_start` automatically. It is not idempotent, and a
retry can send a second email or book a second appointment — ask first.
