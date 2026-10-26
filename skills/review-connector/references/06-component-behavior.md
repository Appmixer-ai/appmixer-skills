# Part 6: Component Behavior (JavaScript)

The behavior file contains the component's logic.

## Basic Structure

### `receive` Method

The `receive` function is called when the component receives data from the input port.

```javascript
module.exports = {
    async receive(context) {

        // Get input data
        const { message, priority, count } = context.messages.in.content;

        // Perform the action
        const response = await context.httpRequest({
            method: 'POST',
            url: 'https://api.service.com/messages',
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`,
                'Content-Type': 'application/json'
            },
            data: {
                text: message,
                priority: priority,
                count: count
            }
        });

        // Return the result
        return context.sendJson(response.data, 'out');
    }
};
```

### Sending Output: Always `await` or `return`

`context.sendJson()`, `context.send()` and `context.sendArray()` return a
promise. **Every send MUST be awaited, or returned when it is the last
statement.** `receive()`, `tick()` and `start()` must not resolve while a send
is still in flight.

The engine acks the input message as soon as the component's promise resolves.
A send that has not finished by then is counted only when it reaches the queue:

- Inside an engine-tracked **Each** loop, the item can finish before its output
  is counted. A sequential loop starts the next item next to it, and output that
  reaches `Continue Each` too late is reported as `dropped`.
- A **flow run** can be declared finished before the late send lands.
- A **failed send is never attributed to the message**. `receive()` has already
  succeeded, so retry and error handling never see the failure.

The engine deliberately does not wait for sends that were not awaited.
Awaiting them is the component's job.

```javascript
// ❌ Wrong: the promise is dropped
context.sendJson(item, 'out');

// ❌ Wrong: forEach discards what the callback returns, async or not
items.forEach(async item => {
    await context.sendJson(item, 'out');
});

// ✅ Right: the last statement returns the send
return context.sendJson(item, 'out');

// ✅ Right: one at a time, in order
for (const item of items) {
    await context.sendJson(item, 'out');
}

// ✅ Right: in parallel, the map callback returns each send
await Promise.all(items.map(item => context.sendJson(item, 'out')));
```

A helper that sends (`lib.sendArrayOutput`) must be awaited by its caller as
well. The `send-output-awaited` validator flags a bare send statement and a send
inside a `forEach` callback. It cannot follow a helper whose promise the caller
drops, so check those by hand.

## Advanced Features

### Scheduling Work Later: `context.setTimeout`

`context.setTimeout(content, ms)` re-invokes the component after `ms` with the
payload on `context.messages.timeout`. It is the mechanism behind poll
continuations, debounce windows and subscription renewals: the worker is freed
in between, and the scheduled message keeps its scope and correlation id, so the
continuation emits into the branch that started it.

**Any delay under one minute is silently rounded up to one minute.** The engine
clamps with `Math.max(timeout, WAITING_QUEUE_MIN_TIMEOUT)` — 60 000 ms by
default. No error, no warning, no log entry. `context.setTimeout(payload, 5000)`
reads as a five-second debounce and behaves as a sixty-second one.

Two things about that clamp are what keep letting sub-minute delays ship:

- **Test mode has no floor.** Under `appmixer test component` the delay takes a
  different path (`Math.min(timeout, 120000)`), so a sub-minute value does
  exactly what it says — and then behaves differently in production. A passing
  component test proves nothing about the interval.
- **Comments and error messages derived from the intended value become wrong.**
  `POLL_INTERVAL_MS = 30000` with `MAX_POLLS = 60` is not "up to 30 minutes",
  it is up to 60 — and the timeout error then reports a duration that never
  elapsed.

So: never pass a delay below 60 000 ms, and never compute a total duration from
one. Where the interval is configurable, floor the configured value too — a
config knob is exactly where a 30-second value gets set later.

Treat the floor as a deployment setting rather than a constant: it is
env-configurable, so do not write code that depends on its exact value in
either direction. The ceiling is separate — `INPUT_QUEUE_MAX_MESSAGE_DELAY`,
31 days by default — and exceeding *that* throws instead of clamping.

Above the floor the delay is honoured to about a second: the scheduler
pre-fetches due timeouts and sleeps until each one's exact due time, so 90 s
means 90 s and not the next whole minute. A last poll shortened to fit a
deadline (`Math.min(interval, remaining)`) is therefore a no-op whenever it
would drop below the floor — it clamps straight back to a minute, and the
timeout error simply arrives up to a minute late.

`setTimeout` resolves to a `timeoutId`. `context.clearTimeout(id)` cancels the
pending message, and still works after the scheduler has already queued it.

### Trigger Components

```javascript
module.exports = {
    async tick(context) {
        // Called periodically for polling
        const newItems = await fetchNewItems(context);

        for (const item of newItems) {
            await context.sendJson(item, 'out');
        }
    }
};
```

### Webhook Components

Registration belongs to the lifecycle methods, not to `receive()` (see
"Trigger Behavior Requirements" in `07-component-types.md`):

```javascript
module.exports = {
    async start(context) {
        // Register the webhook with the external service when the flow starts
        const { id } = await registerWebhook(context, context.getWebhookUrl());
        return context.saveState({ webhookId: id });
    },

    async stop(context) {
        // Unregister it when the flow stops
        const { webhookId } = await context.loadState();
        return unregisterWebhook(context, webhookId);
    },

    async receive(context) {
        // Handle the incoming webhook payload
        if (context.messages.webhook) {
            await context.sendJson(context.messages.webhook.content.data, 'out');
            return context.response();
        }
    }
};
```

---
