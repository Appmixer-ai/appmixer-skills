# Async Components (jobs that finish later)

Some provider operations do not finish inside one request: transcription,
enrichment, rendering, video encoding, a human approval. The component must
return control immediately **and still deliver the result into the same flow**.

This file covers the two shapes that work and the four that do not.

## Decision rule

| The provider offers | Use | Reference implementation |
|---------------------|-----|--------------------------|
| A callback / webhook URL parameter | **Self-callback** — `"webhook": true` + `context.getWebhookUrl()` | `clearbit/enrichment/FindPerson`, `plivo/sms/SendSMSAndWaitForReply`, `twilio/calls/ForwardCall`, `utils/tasks/RequestApproval` |
| Only a status endpoint to poll | **Continuation chain** — `context.setTimeout` | `gladia/core/TranscribeAudio`, `akamai/lib.js` |

Prefer the self-callback whenever the provider supports one: it delivers in
seconds, while polling inherits whatever visibility lag the provider's job/log
API has (Deepgram's request log lags 12–17 minutes — see `09-testing.md`).

---

## 1. Self-callback

The component hands the provider **its own** webhook URL, so the same component
that started the job is the one the provider reports back to. No trigger, no
second flow, no polling.

```
receive(in) ──▶ submit job, callback = context.getWebhookUrl() ──▶ out { job id + echo }
                                       │
provider finishes, POSTs the result ───┘
receive(webhook) ──▶ look up the echo by job id ──▶ done { result + echo }
```

### component.json

```json
{
    "webhook": true,
    "outPorts": [
        { "name": "out",  "schema": { "…": "job id + the echoed input" } },
        { "name": "done", "schema": { "…": "the result + the same echo" } }
    ]
}
```

`"webhook": true` is what makes `context.getWebhookUrl()` available inside
`receive()`. The component stays a **plain action** — no `trigger`, no `tick`.

### Behavior

```javascript
// The echo rides in the callback URL, NOT in component state. See
// "Carry the echo in the callback URL" below for why state loses jobs.
const ECHO_PARAM = 'echo';

function buildCallbackUrl(context, echo) {
    const base = context.getWebhookUrl();
    const separator = base.indexOf('?') === -1 ? '?' : '&';
    return `${base}${separator}${ECHO_PARAM}=${encodeURIComponent(JSON.stringify(echo))}`;
}

function readEcho(context) {
    const raw = ((context.messages.webhook.content || {}).query || {})[ECHO_PARAM];
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};   // a malformed echo must not cost the result
    }
}

module.exports = {

    async receive(context) {

        // ── the provider calling back ──────────────────────────────────
        if (context.messages.webhook) {

            const body = (context.messages.webhook.content || {}).data || {};
            const requestId = (body.metadata || {}).request_id;

            // Anything can POST to a webhook URL. Without this guard a stray or
            // replayed request emits a `done` with an empty result that
            // downstream cannot tell from a real one.
            if (!requestId) {
                await context.log('warn', 'Ignoring a callback with no job id.', { body });
                return context.response();
            }

            try {
                await context.sendJson({
                    ...readEcho(context),
                    request_id: requestId,
                    result: body.result
                }, 'done');
            } finally {
                // Acknowledge even if the emit threw: without a 2xx the provider
                // redelivers, and the redelivery re-runs whatever just failed.
                await context.response();
            }

            return;
        }

        // ── the submit ─────────────────────────────────────────────────
        const { audioUrl, fileId, correlationId } = context.messages.in.content;
        const echo = { audioUrl, fileId, correlationId };

        let data;
        let stream;
        if (audioUrl) {
            data = { url: audioUrl };
        } else {
            stream = await context.getFileReadStream(fileId);
            data = stream;
        }

        let response;
        try {
            response = await lib.apiRequest(context, {
                method: 'POST',
                path: '/v1/jobs',
                params: { callback: buildCallbackUrl(context, echo) },
                data
            });
        } catch (error) {
            // The upload stream is ours to close. Left open on a 413/429/5xx it
            // holds a file descriptor, and an auto-retried component opens
            // another one on every attempt.
            if (stream && typeof stream.destroy === 'function') stream.destroy();
            throw error;
        }

        const requestId = (response.data || {}).request_id;

        // No job id means the job was never linked to this flow: the callback
        // cannot be attributed and `out` would carry request_id: undefined into
        // the rest of the flow. Fail loudly instead of degrading silently.
        if (!requestId) {
            throw new context.CancelError(
                'The provider accepted the request but returned no job id, so the result '
                + 'cannot be delivered on the "done" port. Retry the job.'
            );
        }

        return context.sendJson({ ...echo, request_id: requestId }, 'out');
    }
};
```

### The echo is mandatory, not a nicety

**One component instance has ONE callback URL.** It is keyed by flow and
component — not by message. Ten parallel jobs all report back to the same place
and arrive in completion order, so the fifth `done` may belong to the eighth
input, and the webhook branch cannot see the message that started the job.

Nothing is *mixed up* — each callback carries its own payload — but without an
echo a downstream component cannot tell which result belongs to which input. So:

- Carry the job's inputs across in the callback URL (below), and replay them on
  the callback.
- Give the user a **Correlation ID** input — any value of their own (an order
  number, a file name, a record id) — and echo it on **both** ports.
- **E2E-assert the Correlation ID on `done`.** A broken echo is invisible until
  someone runs ten jobs at once; an `equal` assertion on the completion port
  catches it on the first run.

### Carry the echo in the callback URL, not in component state

The callback URL is yours: append your own query string to
`context.getWebhookUrl()` and read it back from
`context.messages.webhook.content.query`. This is an established Appmixer
mechanism — `utils/forms/FormAction` keys its state off `?inputMessageId=`, and
`google/drive` appends `?enqueueOnly=true`.

Stashing the echo in component state under the job id looks equivalent and is
not. It fails four ways, all of which only show up under load:

| State-keyed echo | What happens |
|------------------|--------------|
| **The callback races the write.** The provider starts working the instant it accepts the job, so the callback can land before the `stateSet` that follows the submit commits. | The echo is gone from `done` — exactly the field the mechanism exists to deliver. Worse, the callback's `stateUnset` runs *before* the submit's `stateSet`, so the entry is then leaked permanently. Measured margin on a 26 s audio job: ~0.5 s. A one-second job and a loaded state store close it. |
| **A redelivered callback finds the entry consumed.** | A second `done` with no echo at all. |
| **`stateSet`/`stateUnset` has no TTL** (the two-argument form is the only one). | A job that never calls back leaks its entry forever. |
| **`stateUnset` throwing blocks the ack.** | No 2xx → the provider redelivers → duplicate `done`. |

The URL has none of these: it is per-job by construction, unaffected by write
latency, needs no cleanup, and a redelivered callback carries the same complete
echo. Keep the payload small — a correlation id and the input references, not
the whole input message.

Some providers offer a native equivalent (Deepgram's `tag`, echoed back in
`metadata.tags`). Either is fine; both beat state.

### Delivery is at-least-once, and a lost callback is silent

Two properties of this shape that no amount of code removes — design the flow
around them rather than pretending otherwise:

- **A callback can arrive twice.** The `finally` ack above removes the failure
  modes you control; provider-side retries remain. Because the echo travels in
  the URL, a repeat is a *complete* duplicate rather than a degraded one.
- **A job that never calls back stalls its branch forever.** No error, no
  timeout, no dead letter — `out` fired and `done` never will. A watchdog would
  need per-job state to know whether the job already finished, which reintroduces
  everything the URL-carried echo just removed. Say so in the component
  description instead.

### Async submits do not hold a quota concurrency slot

A `limit-concurrency` quota rule holds its slot for the duration of `receive()`.
While the component blocked on a synchronous endpoint that bounded **in-flight
jobs**; once it submits and returns in a couple of seconds it bounds only
**concurrent submissions**, and the provider's jobs pile up unbounded behind it.

Converting a component from blocking to self-callback therefore silently drops
whatever protection that rule was written for. Re-read the quota comment when
you make that change: either correct it to describe what it now does, or lean on
the sliding-window rule, which is what actually bounds the rate work is handed
over. Do not leave a comment claiming a cap the rule no longer provides.

### Do not expose the callback URL as an input

It looks helpful and it is a footgun: the moment a user fills it in, the
provider delivers elsewhere and the `done` port silently never fires. None of
the four reference components expose one. A user who wants the result somewhere
else sends `done` onward to an HTTP component.

---

## 2. Continuation chain (no callback available)

When the provider only offers "submit, then poll status", do not sleep in the
component — schedule a continuation with `context.setTimeout` and let the worker
go. State travels in the timeout payload.

```javascript
async receive(context) {

    // A continuation scheduled by a previous invocation.
    if (context.messages.timeout) {
        const { jobId, deadline, pollIntervalMs } = context.messages.timeout.content;
        const { data } = await lib.apiRequest(context, { path: `/jobs/${jobId}` });

        if (data.status === 'done') {
            return context.sendJson(data, 'out');
        }
        if (Date.now() > deadline) {
            throw new context.CancelError(`Job ${jobId} did not finish in time.`);
        }
        return context.setTimeout({ jobId, deadline, pollIntervalMs }, pollIntervalMs);
    }

    // The submit.
    const { data } = await lib.apiRequest(context, { method: 'POST', path: '/jobs', data: payload });
    return context.setTimeout({
        jobId: data.id,
        deadline: Date.now() + timeoutSeconds * 1000,
        pollIntervalMs
    }, pollIntervalMs);
}
```

**Appmixer will not schedule a continuation shorter than one minute** — use
that as the floor and the default poll interval, and never derive a total wait
from a shorter value. Why (silent clamp in production, no floor in test mode)
is in `06-component-behavior.md` — "Scheduling Work Later".

---

## Anti-patterns

| Do not | Why |
|--------|-----|
| Block on the provider's synchronous endpoint | The provider holds the connection until the job is done: one worker per job, and a gateway timeout past the provider's ceiling (Deepgram: 504 after 10 minutes, 20 for Whisper) |
| Use `tick()` to deliver the completion | A tick emit has no message scope — it cannot continue the branch that started the job, and it cannot see the input that produced it |
| Make a separate polling trigger the completion path | Couples two flows, and inherits the provider's log/visibility lag (measured: 12–17 min vs. 4 s by callback) |
| Expose the callback URL as a component input | Setting it silently kills the `done` port |
| Stash the per-job echo in component state | The callback races the write, a redelivery finds it consumed, and there is no TTL — see "Carry the echo in the callback URL" |
| Emit `done` before checking the callback carries a job id | Any POST to the webhook URL then produces an empty-result `done` downstream cannot distinguish |
| `return context.response()` after the emit, outside a `finally` | An emit that throws never acks, the provider redelivers, and the redelivery re-runs the failure |
| Hand a file read stream to the request and let an error path drop it | The descriptor stays open until GC, and an auto-retried component opens a new one per attempt |
| Keep a `limit-concurrency` quota comment written for the blocking version | The slot is released when `receive()` returns — it no longer caps in-flight jobs |

A polling trigger is still legitimate **on its own** — for jobs submitted
outside Appmixer. It just must not be the way an action component gets its own
result back.

## Testing an async component

E2E-test both ports in one flow: assert the job id on `out` **and** the result
on `done`, and wire both asserts into `AfterAll` so the flow cannot pass while
the callback path is broken. Size the `AfterAll` window for the provider's real
job duration.

If the component takes a Correlation ID, assert it comes back on `done` — that
is the only cheap way to catch a broken echo before a user hits it with ten
parallel jobs. Use `equal` against the value the flow set, not `notEmpty`: a
`notEmpty` on a field the component happens to copy from elsewhere passes while
the echo is broken.

Two failure modes E2E will not surface, so check them by reading the code:

- **The submit's error path.** Force a 4xx (an unreachable audio URL, an
  oversized payload) and confirm nothing is left open and the message is the
  connector's normalized one, not a bare `Request failed with status code NNN`.
- **A callback arriving twice.** Re-POST the same body to the webhook URL and
  confirm the second `done` is a complete duplicate — same echo, same result —
  rather than a degraded one.
