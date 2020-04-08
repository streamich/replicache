# Replicache Quick Start

This document walks you through getting [Replicache](https://replicache.dev) integrated with your existing backend in a basic way. It should take a few hours to a day, depending on the complexity of your system.

Questions? Comments? [Join us on Slack](https://join.slack.com/t/rocicorp/shared_invite/zt-dcez2xsi-nAhW1Lt~32Y3~~y54pMV0g).

**Note:** This document assumes you already know what Replicache is, why you might need it, and broadly how it works. If that's not true, see the [Replicache homepage](https://replicache.dev) for an overview, or the [design document](design.md) for a detailed deep-dive.

# Overview

To integrate Replicache into an existing service, you're gonna make changes on both the client and the server.

![Picture of Replicache Architecture](diagram.png)

# Client Side

On the client side, you'll link the Replicache Client SDK into your application and use it as your local storage layer.

Currently we only support Flutter clients. See the [Replicache Flutter SDK](https://github.com/rocicorp/replicache-sdk-flutter) repo for setup instructions.

[Let us know on Slack](https://join.slack.com/t/rocicorp/shared_invite/zt-dcez2xsi-nAhW1Lt~32Y3~~y54pMV0g) which client environment you'd like us to add support fo rnext.

# Server Side

### Step 1: Get the SDK

Download the [Replicache SDK](https://github.com/rocicorp/replicache/releases/latest/download/replicache-sdk.tar.gz), then unzip it:

```bash
curl -o replicache-sdk.tar.gz -L https://github.com/rocicorp/replicache/releases/latest/download/replicache-sdk.tar.gz
tar xvzf replicache-sdk.tar.gz
```

### Step 2: Downstream Sync

Implement a *Client View* endpoint on your service that returns the data that should be available locally on the client for each user. This endpoint should return the *entire* view every time it is requested.

Replicache will frequently query this endpoint and calculate a diff to return to each client.

The format of the client view is JSON that matches the following [JSON Schema](https://json-schema.org/):

```jsonschema
{
  "type": "object",
  "properties": {
    // The last Replicache Mutation ID that your service has processed.
    "lastMutationID": {"type": "integer", "minimum": 0},

    // An arbitrary map of key/value pairs. Any JSON value is legal for values.
    // This is the data that will be available on the client side.
    "clientView": {"type": "object"}
  },
  "required": ["lastMutationID", "clientView"]
}
```

For example, a hypothetical TODO app might return the following Client View:

```jsonc
{
  "lastMutationID": 0,
  "clientView": {
    "/todo/1": {
      "title": "Take out the trash",
      "description": "Don't forget to pull it to the curb.",
      "done": false,
    },
    "/todo/2": {
      "title": "Pick up milk",
      "description": "2%",
      "done": true,
    },
    ...
  }
}
```

To authenticate users, use the `Authorization` HTTP header as normal.

### Step 3: Test Downstream Sync

You can simulate the client syncing downstream with curl.

First start a development diff-server:

```bash
# The --clientview parameter should point to the Client View endpoint you implemented above.
build/out/<your-platform>/diffs --db=/tmp/foo serve \
  --clientview=http://localhost:8000/replicache-client-view
```

Then *pull* from that diff-server:

```bash
curl -H "Authorization:sandbox" -d '{"clientID":"c1", "baseStateID":"00000000000000000000000000000000", "checksum":"00000000"}' http://localhost:7001/pull
```

The payload of `pull` must match the JSON Schema:

```jsonc
{
  "type": "object",
  "properties": {
    // The clientID is a string that uniquely identifies a client device that is syncing via Replicache
    // within a single account. You can specify any client ID you want while testing.
    "clientID": {
      "type": "string",
      "regex": "[a-zA-Z0-9\\-_/]+"
    },
    // The baseStateID is the last state ID the requesting client has. diff-server will return a diff
    // with respect to this state.
    "baseStateID": {
      "type": "string"
    },
    // The checksum of baseStateID. diff-server checks that this checksum matches its records, and only
    // returns an incremental diff if so.
    "checksum": {
      "type": "string"
    },
    // The "Authorization" HTTP Header diff-server will send with the request to clientView. Use this
    // to authenticate the requesting user of your service.
    "clientViewAuth": {
      "type": "string"
    }
  },
  "required": ["clientID", "baseStateID", "checksum"]
}
```

#### Incremental Sync Example

Here's a complete example of doing an initial sync then an incremental sync against our [sample TODO app](https://github.com/rocicorp/replicache-sample-todo):

```bash
CLIENT_VIEW=https://replicache-sample-todo.now.sh/serve/client-view
NEW_USER_EMAIL=$RANDOM@foo.com
PLATFORM=darwin-amd64 # or linux-amd64

# Start diffs talking to TODO service
./build/out/$PLATFORM/diffs --db=/tmp/foo serve --clientview=$CLIENT_VIEW &

# Create a new user
curl -d "{\"email\":\"$NEW_USER_EMAIL\"}" https://replicache-sample-todo.now.sh/serve/login

USER_ID=<user-id-from-prev-cmd>
LIST_ID=$RANDOM
TODO_ID=$RANDOM

# Create a first TODO
curl -H "Authorization:$USER_ID" -d "{\"id\": $TODO_ID, \"listID\": $LIST_ID, \"text\": \"Take out the trash\", \"complete\": true, \"order\": 0.5}" \
https://replicache-sample-todo.now.sh/serve/todo-create

# Do an initial pull from diff-server
curl -H "Authorization:sandbox" -d "{\"clientID\":\"c1\", \"baseStateID\":\"00000000000000000000000000000000\", \"checksum\":\"00000000\", \"clientViewAuth\": \"$USER_ID\"}" \
http://localhost:7001/pull

BASE_STATE_ID=<stateID from prev response>
CHECKSUM=<checksum from prev response>

# Create a second TODO
TODO_ID=$RANDOM
curl -H "Authorization:$USER_ID" -d "{\"id\": $TODO_ID, \"listID\": $LIST_ID, \"text\": \"Walk the dog\", \"complete\": false, \"order\": 0.75}" \
https://replicache-sample-todo.now.sh/serve/todo-create

# Do an incremental pull from diff-server
# Note that only the second todo is returned
curl -H "Authorization:sandbox" -d "{\"clientID\":\"c1\", \"baseStateID\":\"$BASE_STATE_ID\", \"checksum\":\"$CHECKSUM\", \"clientViewAuth\": \"$USER_ID\"}" \
http://localhost:7001/pull

fg
```

### Step 4: Mutation ID Storage

Next up: Writes.

Replicache identifies each change (or *Mutation*) that originates on the Replicache Client with a *MutationID*.

Your service must track the last MutationID it has processed for each client, and return it to Replicache in the Client View response. This allows Replicache to know when it can discard the speculative version of that change from the client.

Depending on how your service is built, storing MutationIDs can be done a number of ways. But typically you'll store them in the same database as your user data and update them transactionally as part of each mutation.

If you use e.g., Postgres, for your user data, you might store Replicache Change IDs in a table like:

<table>
  <tr>
    <th colspan=2>ReplicacheMutationIDs</th>
  </tr>
  <tr>
    <td>ClientID</td>
    <td>CHAR(32)</td>
  </tr>
  <tr>
    <td>LastMutationID</td>
    <td>INT64</td>
  </tr>
</table>

### Step 5: Upstream Sync

Replicache implements upstream sync by queuing calls to your existing server-side endpoints. Queued calls are invoked when
there's connectivity in batches. By default Replicache posts the batch to `https://yourdomain.com/replicache-batch`.

The payload of the batch request is JSON, of the form:

```json
{
  "clientID": "CB94867E-94B7-48F3-A3C1-287871E1F7FD",
  "mutations": [
    {
      "id": 7,
      "path": "/api/todo/create",
      "payload": "{\"id\": \"AE2E880D-C4BD-473A-B5E0-29A4A9965EE9\", \"title\": \"Take out the trash\", ..."
    },
    {
      "id": 8,
      "path": "/api/todo/toggle-done",
      "payload": "{\"id\": \"AE2E880D-C4BD-473A-B5E0-29A4A9965EE9\", \"done\": true}"
    },
    ...
  ]
}
```

The response format is:

```json
{
  "mutations": [
    {
      "id": 7,
      "result": "OK"
    },
    {
      "id": 8,
      "result": "ERROR",
      "message": "Invalid POST data: syntax error: ..."
    },
    {
      "id": 9,
      "result": "RETRY",
      "message": "Backend unavailable"
    },
  ]
}
```

Notes on correctly implementing the batch endpoint:

* Replicache can end up sending the same mutation multiple times. You **MUST** ensure mutation handlers are [idempotent](https://en.wikipedia.org/wiki/Idempotence#Computer_science_meaning). We recommend that you use the provided MutationID for idempotency (see pseudocode below).
* If a request cannot be handled temporarily (e.g., because some backend component is down), return the result `"RETRY"` and stop processing the batch. Replicache will retry the remainder of the batch later.
* Once the batch endpoint returns `OK` for a mutation, that mutation **MUST** eventually be processed and reflected in the ClientView. In simple systems this will happen immediately. But it OK for processing to also be queued, as long as it does eventually happen.

TODO: Add some links to sample code here.

### Step 6: Include the Last Processed Mutation ID in the Client View

In Step 2, we hardcoded `lastMutationID` to zero.

Now we're going to return the correct value so that the client can discard pending mutations that have been applied to the client view. For our simple batch endpoint pseudocode above, this would just be:

```
response.lastMutationID = getLastMutationID()
```

### Step 7: 🎉🎉

That's it! You're done with the backend integration. If you haven't yet, you'll need to do the [client integration](#client-side) next.

Happy hacking!
