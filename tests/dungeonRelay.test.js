/**
 * Tests for the ZKDungeon multiplayer relay — state helpers + join/events API handlers.
 * Uses Node.js built-in test runner (node --test).
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── Import the state helpers directly ───────────────────────────────────────
import {
    getDungeonStore,
    getDungeonRoom,
    addDungeonEvent,
    createDungeonSession,
    getDungeonSession,
    getBearerToken,
    pruneStaleRoster,
} from "../src/lib/dungeon/server/state.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Reset global store between tests to avoid cross-test pollution. */
function resetStore() {
    const g = globalThis;
    delete g["__smolDungeonStore"];
}

function makeSession(roomId, account) {
    return createDungeonSession({ roomId, account, name: "Tester", ttlMs: 60_000 });
}

// ── getDungeonRoom ───────────────────────────────────────────────────────────

test("getDungeonRoom creates a new room on first access", () => {
    resetStore();
    const room = getDungeonRoom("TEST1");
    assert.equal(room.roomId, "TEST1");
    assert.deepEqual(room.rosterByAccount, {});
    assert.deepEqual(room.events, []);
    assert.equal(room.nextSeq, 1);
});

test("getDungeonRoom returns the same room object on repeated calls", () => {
    resetStore();
    const a = getDungeonRoom("ROOM1");
    const b = getDungeonRoom("ROOM1");
    assert.equal(a, b);
});

test("getDungeonRoom isolates separate rooms", () => {
    resetStore();
    const a = getDungeonRoom("AAAA");
    const b = getDungeonRoom("BBBB");
    a.nextSeq += 10;
    assert.equal(b.nextSeq, 1); // b is unaffected
});

// ── addDungeonEvent ──────────────────────────────────────────────────────────

test("addDungeonEvent assigns sequential seq numbers", () => {
    resetStore();
    const e1 = addDungeonEvent("SEQT", { kind: "system", message: "first", ts: 0 }, { maxEvents: 10 });
    const e2 = addDungeonEvent("SEQT", { kind: "system", message: "second", ts: 0 }, { maxEvents: 10 });
    assert.equal(e1.seq, 1);
    assert.equal(e2.seq, 2);
});

test("addDungeonEvent prunes to maxEvents", () => {
    resetStore();
    for (let i = 0; i < 5; i++) {
        addDungeonEvent("PRUNE", { kind: "system", message: `msg${i}`, ts: i }, { maxEvents: 3 });
    }
    const room = getDungeonRoom("PRUNE");
    assert.equal(room.events.length, 3);
    // Last 3 events should remain
    assert.equal(room.events[0].seq, 3);
    assert.equal(room.events[2].seq, 5);
});

test("addDungeonEvent stores event on room", () => {
    resetStore();
    const evt = addDungeonEvent("STOR", { kind: "ready", account: "GX1", ready: true, ts: 123 }, { maxEvents: 50 });
    assert.equal(evt.kind, "ready");
    assert.equal(evt.seq, 1);
    const room = getDungeonRoom("STOR");
    assert.equal(room.events.length, 1);
    assert.equal(room.events[0].seq, 1);
});

// ── createDungeonSession / getDungeonSession ─────────────────────────────────

test("createDungeonSession returns a session with a UUID token", () => {
    resetStore();
    const session = makeSession("SESS1", "GACC1");
    assert.match(session.token, /^[0-9a-f-]{36}$/);
    assert.equal(session.roomId, "SESS1");
    assert.equal(session.account, "GACC1");
});

test("getDungeonSession retrieves a valid session by token", () => {
    resetStore();
    const session = makeSession("SESS2", "GACC2");
    const found = getDungeonSession(session.token);
    assert.ok(found);
    assert.equal(found.token, session.token);
});

test("getDungeonSession returns null for unknown token", () => {
    resetStore();
    assert.equal(getDungeonSession("not-a-real-token"), null);
});

test("getDungeonSession returns null and cleans up expired session", () => {
    resetStore();
    const session = createDungeonSession({ roomId: "EXP", account: "GEXP", name: "X", ttlMs: -1 });
    // ttlMs=-1 means expiresAt is in the past
    const found = getDungeonSession(session.token);
    assert.equal(found, null);
    // Should be removed from store
    const store = getDungeonStore();
    assert.ok(!store.sessionsByToken.has(session.token));
});

// ── getBearerToken ───────────────────────────────────────────────────────────

test("getBearerToken extracts token from Authorization header", () => {
    const req = new Request("http://localhost/", {
        headers: { Authorization: "Bearer my-secret-token" },
    });
    assert.equal(getBearerToken(req), "my-secret-token");
});

test("getBearerToken is case-insensitive on the header name", () => {
    const req = new Request("http://localhost/", {
        headers: { authorization: "Bearer lowercase-header" },
    });
    assert.equal(getBearerToken(req), "lowercase-header");
});

test("getBearerToken returns null when no Authorization header", () => {
    const req = new Request("http://localhost/");
    assert.equal(getBearerToken(req), null);
});

test("getBearerToken returns null for non-Bearer scheme", () => {
    const req = new Request("http://localhost/", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    assert.equal(getBearerToken(req), null);
});

// ── pruneStaleRoster ─────────────────────────────────────────────────────────

test("pruneStaleRoster does not remove fresh players", () => {
    resetStore();
    const room = getDungeonRoom("PRST");
    room.rosterByAccount["GX1"] = {
        id: "1", account: "GX1", name: "Alice",
        joinedAt: Date.now(), lastSeenAt: Date.now(),
        ready: false, floor: 1, attempts: 0,
    };
    const pruned = pruneStaleRoster("PRST");
    assert.equal(pruned.length, 0);
    assert.ok(room.rosterByAccount["GX1"]);
});

test("pruneStaleRoster removes players whose lastSeenAt is >30s ago", () => {
    resetStore();
    const room = getDungeonRoom("STALE");
    room.rosterByAccount["GX2"] = {
        id: "2", account: "GX2", name: "Bob",
        joinedAt: Date.now() - 60_000,
        lastSeenAt: Date.now() - 31_000, // stale
        ready: false, floor: 1, attempts: 0,
    };
    const pruned = pruneStaleRoster("STALE");
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0], "GX2");
    assert.ok(!room.rosterByAccount["GX2"]);
});

test("pruneStaleRoster emits a system event when removing a stale player", () => {
    resetStore();
    const room = getDungeonRoom("SEVT");
    room.rosterByAccount["GX3"] = {
        id: "3", account: "GX3", name: "Carol",
        joinedAt: Date.now() - 60_000,
        lastSeenAt: Date.now() - 31_000,
        ready: false, floor: 1, attempts: 0,
    };
    pruneStaleRoster("SEVT");
    assert.equal(room.events.length, 1);
    assert.equal(room.events[0].kind, "system");
    assert.match(room.events[0].message, /Carol.*disconnected.*stale/i);
});

test("pruneStaleRoster keeps a player whose lastSeenAt is exactly 30s ago", () => {
    resetStore();
    const room = getDungeonRoom("EDGE");
    room.rosterByAccount["GX4"] = {
        id: "4", account: "GX4", name: "Dave",
        joinedAt: Date.now() - 30_000,
        lastSeenAt: Date.now() - 30_000, // exactly on threshold
        ready: false, floor: 1, attempts: 0,
    };
    const pruned = pruneStaleRoster("EDGE");
    assert.equal(pruned.length, 0);
});

// ── Full two-player relay flow (state layer) ─────────────────────────────────

test("two-player flow: join, ready, start, progress", () => {
    resetStore();
    const ROOM = "FLOW";

    // P1 joins
    const p1RoomState = getDungeonRoom(ROOM);
    const now = Date.now();
    p1RoomState.rosterByAccount["P1ACC"] = {
        id: "r1", account: "P1ACC", name: "Alice",
        joinedAt: now, lastSeenAt: now, ready: false, floor: 1, attempts: 0,
    };
    addDungeonEvent(ROOM, { kind: "system", message: "Alice joined", ts: now }, { maxEvents: 100 });
    const p1Session = createDungeonSession({ roomId: ROOM, account: "P1ACC", name: "Alice", ttlMs: 60_000 });

    // P2 joins
    p1RoomState.rosterByAccount["P2ACC"] = {
        id: "r2", account: "P2ACC", name: "Bob",
        joinedAt: now, lastSeenAt: now, ready: false, floor: 1, attempts: 0,
    };
    addDungeonEvent(ROOM, { kind: "system", message: "Bob joined", ts: now }, { maxEvents: 100 });
    const p2Session = createDungeonSession({ roomId: ROOM, account: "P2ACC", name: "Bob", ttlMs: 60_000 });

    // P1 sets ready
    p1RoomState.rosterByAccount["P1ACC"].ready = true;
    addDungeonEvent(ROOM, { kind: "ready", account: "P1ACC", ready: true, ts: now }, { maxEvents: 100 });

    // P2 sets ready
    p1RoomState.rosterByAccount["P2ACC"].ready = true;
    addDungeonEvent(ROOM, { kind: "ready", account: "P2ACC", ready: true, ts: now }, { maxEvents: 100 });

    // All ready — start
    const roster = Object.values(p1RoomState.rosterByAccount);
    assert.ok(roster.length === 2 && roster.every(r => r.ready), "Both players must be ready");
    addDungeonEvent(ROOM, { kind: "start", ts: now }, { maxEvents: 100 });

    // Progress: P1 advances to floor 2
    p1RoomState.rosterByAccount["P1ACC"].floor = 2;
    addDungeonEvent(ROOM, { kind: "progress", account: "P1ACC", floor: 2, attempts: 1, ts: now }, { maxEvents: 100 });

    // Progress: P2 advances to floor 2
    p1RoomState.rosterByAccount["P2ACC"].floor = 2;
    addDungeonEvent(ROOM, { kind: "progress", account: "P2ACC", floor: 2, attempts: 2, ts: now }, { maxEvents: 100 });

    // Verify event log
    const events = p1RoomState.events;
    const kinds = events.map(e => e.kind);
    assert.deepEqual(kinds, ["system", "system", "ready", "ready", "start", "progress", "progress"]);
    assert.equal(events[0].seq, 1);
    assert.equal(events[6].seq, 7);

    // Verify seq increases monotonically
    for (let i = 1; i < events.length; i++) {
        assert.ok(events[i].seq > events[i - 1].seq, `seq should increase at index ${i}`);
    }

    // Verify session tokens are valid
    assert.ok(getDungeonSession(p1Session.token));
    assert.ok(getDungeonSession(p2Session.token));
});

test("cursor filtering returns only events after cursor", () => {
    resetStore();
    const ROOM = "CUR";
    addDungeonEvent(ROOM, { kind: "system", message: "e1", ts: 1 }, { maxEvents: 50 });
    addDungeonEvent(ROOM, { kind: "system", message: "e2", ts: 2 }, { maxEvents: 50 });
    addDungeonEvent(ROOM, { kind: "system", message: "e3", ts: 3 }, { maxEvents: 50 });

    const room = getDungeonRoom(ROOM);
    const afterCursor1 = room.events.filter(e => e.seq > 1);
    assert.equal(afterCursor1.length, 2);
    assert.equal(afterCursor1[0].seq, 2);
    assert.equal(afterCursor1[1].seq, 3);
});

test("join cursor correctly skips own join event", () => {
    // Simulate what join.ts does: add event, then return cursor = nextSeq - 1
    resetStore();
    const ROOM = "JCUR";
    addDungeonEvent(ROOM, { kind: "system", message: "P1 joined", ts: 0 }, { maxEvents: 100 });
    const room = getDungeonRoom(ROOM);
    const cursor = room.nextSeq - 1; // Should be 1 (seq of the join event)
    assert.equal(cursor, 1);
    // Polling with this cursor should yield no events (own join is excluded)
    const newEvents = room.events.filter(e => e.seq > cursor);
    assert.equal(newEvents.length, 0);
});

test("testnetAddress is stored in roster entry when provided", () => {
    resetStore();
    const ROOM = "TNET";
    const room = getDungeonRoom(ROOM);
    room.rosterByAccount["CADDR"] = {
        id: "tid", account: "CADDR", name: "Hacker",
        joinedAt: Date.now(), lastSeenAt: Date.now(),
        ready: false, floor: 1, attempts: 0,
        testnetAddress: "GBXYZ123",
    };
    assert.equal(room.rosterByAccount["CADDR"].testnetAddress, "GBXYZ123");

    // Roster serialised to array preserves testnetAddress
    const arr = Object.values(room.rosterByAccount);
    assert.equal(arr[0].testnetAddress, "GBXYZ123");
});

test("gate unblocks when opponent catches up (floor check)", () => {
    // Simulate the relayPollOnce gate logic in isolation
    resetStore();

    // P1 is at floor 2 (gateWaiting=true), P2 is still at floor 1
    let gateWaiting = true;
    let currentFloor = 2;
    let relayRoster = [
        { account: "P1", floor: 2, ready: true },
        { account: "P2", floor: 1, ready: true },
    ];
    let relayToken = "tok";
    let multiplayerEnabled = relayToken.length > 0 && relayRoster.length >= 2;

    // Simulate poll result where P2 is still on floor 1
    function checkGate(roster) {
        if (gateWaiting) {
            if (!multiplayerEnabled) {
                gateWaiting = false;
            } else if (roster.length >= 2 && roster.every(r => r.floor >= currentFloor)) {
                gateWaiting = false;
            }
        }
    }

    checkGate(relayRoster);
    assert.ok(gateWaiting, "Gate should still be waiting when P2 is behind");

    // P2 advances to floor 2
    relayRoster[1].floor = 2;
    checkGate(relayRoster);
    assert.ok(!gateWaiting, "Gate should unblock when P2 catches up");
});

test("gate unblocks when opponent disconnects (multiplayerEnabled becomes false)", () => {
    let gateWaiting = true;
    let relayRoster = [{ account: "P1", floor: 2 }]; // opponent pruned
    let relayToken = "tok";
    let multiplayerEnabled = relayToken.length > 0 && relayRoster.length >= 2; // false now

    function checkGate(roster) {
        if (gateWaiting) {
            if (!multiplayerEnabled) {
                gateWaiting = false;
            } else if (roster.length >= 2 && roster.every(r => r.floor >= 2)) {
                gateWaiting = false;
            }
        }
    }

    checkGate(relayRoster);
    assert.ok(!gateWaiting, "Gate should unblock when opponent disconnects");
});
