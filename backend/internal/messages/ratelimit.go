package messages

import (
	"strings"
	"sync"
	"time"
)

// RateLimiter is an in-memory per-user chat throttler. It combines a rolling
// window rate limit (burst protection) with duplicate-content detection so a
// compromised or over-excited account cannot flood a channel. All state is
// per-process; for a horizontally-scaled deployment this should move to a
// shared store (e.g. Redis).
type RateLimiter struct {
	mu    sync.Mutex
	users map[string]*rateEntry

	maxBurst       int           // allowed sends per rolling window
	window         time.Duration // the rolling window
	duplicateLimit int           // identical repeats allowed before cooldown
	cooldownBase   time.Duration
	cooldownCap    time.Duration
	forgiveAfter   time.Duration // clean period after a cooldown that resets strikes
}

type rateEntry struct {
	lastNormalized string
	lastAt         time.Time
	dupCount       int
	timestamps     []time.Time
	cooldownUntil  time.Time
	strikes        int
}

func newRateLimiter() *RateLimiter {
	return &RateLimiter{
		users:          make(map[string]*rateEntry),
		maxBurst:       6,
		window:         8 * time.Second,
		duplicateLimit: 2,
		cooldownBase:   5 * time.Second,
		cooldownCap:    60 * time.Second,
		forgiveAfter:   2 * time.Minute,
	}
}

// normalise collapses whitespace so copy-pasted blocks are compared fairly.
func normalise(s string) string { return strings.Join(strings.Fields(s), " ") }

// Allow reports whether userID may send content right now. When the send is
// blocked it returns the number of seconds until the user may try again.
func (rl *RateLimiter) Allow(userID, content string, now time.Time) (ok bool, retryAfter int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	e, exists := rl.users[userID]
	if !exists {
		e = &rateEntry{}
		rl.users[userID] = e
	}

	// Hard cooldown in effect.
	if now.Before(e.cooldownUntil) {
		return false, int(e.cooldownUntil.Sub(now).Seconds()) + 1
	}

	// Cooldown is over: forgive accumulated strikes if the offender stayed
	// clean for a decent stretch, otherwise keep the escalation.
	if !e.cooldownUntil.IsZero() && now.After(e.cooldownUntil.Add(rl.forgiveAfter)) {
		e.strikes = 0
	}

	// Prune the rolling window.
	cutoff := now.Add(-rl.window)
	kept := e.timestamps[:0]
	for _, ts := range e.timestamps {
		if ts.After(cutoff) {
			kept = append(kept, ts)
		}
	}
	e.timestamps = kept

	content = normalise(content)

	// Burst protection: too many messages in the window.
	if len(e.timestamps) >= rl.maxBurst {
		return rl.startCooldown(e, now)
	}

	// Duplicate protection: identical content repeated too often.
	if content != "" && content == e.lastNormalized && now.Sub(e.lastAt) <= rl.window {
		e.dupCount++
		if e.dupCount > rl.duplicateLimit {
			e.dupCount = 0
			return rl.startCooldown(e, now)
		}
	} else {
		e.dupCount = 1
	}

	e.timestamps = append(e.timestamps, now)
	e.lastNormalized = content
	e.lastAt = now
	return true, 0
}

// startCooldown blocks the user with an escalating backoff and returns the
// seconds the caller should wait before retrying. The rolling window is reset
// so that once the cooldown expires the user gets a fresh budget (repeated
// offences escalate the backoff up to cooldownCap).
func (rl *RateLimiter) startCooldown(e *rateEntry, now time.Time) (bool, int) {
	e.strikes = min(e.strikes+1, 8)
	d := rl.cooldownBase * time.Duration(e.strikes)
	if d > rl.cooldownCap {
		d = rl.cooldownCap
	}
	e.cooldownUntil = now.Add(d)
	e.timestamps = e.timestamps[:0]
	e.lastNormalized = ""
	e.lastAt = time.Time{}
	e.dupCount = 0
	return false, int(d.Seconds())
}
