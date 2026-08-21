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
const jobKey = (requestId) => `job-${requestId}`;

module.exports = {

    async receive(context) {

        // ── the provider calling back ──────────────────────────────────
        if (context.messages.webhook) {

            const body = (context.messages.webhook.content || {}).data || {};
            const requestId = (body.metadata || {}).request_id;

            // The submit branch stashed this job's input under its id; replaying
            // it here is what lets downstream tell parallel jobs apart.
            const submitted = (requestId && await context.stateGet(jobKey(requestId))) || {};

            await context.sendJson({
                ...submitted,
                request_id: requestId,
                result: body.result
            }, 'done');

            if (requestId) {
                await context.stateUnset(jobKey(requestId));
            }

            // Acknowledge, or the provider keeps retrying the callback.
            return context.response();
        }

        // ── the submit ─────────────────────────────────────────────────
        const { audioUrl, correlationId } = context.messages.in.content;

        const response = await lib.apiRequest(context, {
            method: 'POST',
            path: '/v1/jobs',
            params: { callback: context.getWebhookUrl() },
            data: { url: audioUrl }
        });

        const requestId = (response.data || {}).request_id;
        const echo = { audioUrl, correlationId };

        if (requestId) {
            await context.stateSet(jobKey(requestId), echo);
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

Nothing is *mixed up* — each callback carries its own payload — but without the
state-keyed echo a downstream component cannot tell which result belongs to
which input. So:

- Stash the job's inputs in component state under the provider's job id at
  submit time, replay them on the callback, and `stateUnset` afterwards.
- Namespace the key (`job-${id}`) so it cannot collide with other component
  state.
- Give the user a **Correlation ID** input — any value of their own (an order
  number, a file name, a record id) — and echo it on **both** ports.

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

**Appmixer will not schedule a continuation shorter than one minute** — that is
both the floor and a sensible default for the poll interval.

---

## Anti-patterns

| Do not | Why |
|--------|-----|
| Block on the provider's synchronous endpoint | The provider holds the connection until the job is done: one worker per job, and a gateway timeout past the provider's ceiling (Deepgram: 504 after 10 minutes, 20 for Whisper) |
| Use `tick()` to deliver the completion | A tick emit has no message scope — it cannot continue the branch that started the job, and it cannot see the input that produced it |
| Make a separate polling trigger the completion path | Couples two flows, and inherits the provider's log/visibility lag (measured: 12–17 min vs. 4 s by callback) |
| Expose the callback URL as a component input | Setting it silently kills the `done` port |

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
parallel jobs.
