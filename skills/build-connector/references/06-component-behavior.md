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

```javascript
module.exports = {
    async receive(context) {
        const webhookUrl = context.getWebhookUrl();

        // Register webhook with external service
        await registerWebhook(context, webhookUrl);

        return context.sendJson({ webhookUrl }, 'out');
    },

    async webhook(context) {
        // Handle incoming webhook
        const payload = context.messages.webhook;
        return context.sendJson(payload, 'out');
    }
};
```

---
