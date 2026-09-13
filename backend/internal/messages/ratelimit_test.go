package messages

import (
	"fmt"
	"testing"
	"time"
)

func TestRateLimiterBurst(t *testing.T) {
	rl := newRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < rl.maxBurst; i++ {
		ok, _ := rl.Allow("user-1", fmt.Sprintf("message %d", i), now)
		if !ok {
			t.Fatalf("send %d/%d should pass", i+1, rl.maxBurst)
		}
	}
	ok, retryAfter := rl.Allow("user-1", "message blocked", now)
	if ok {
		t.Fatal("burst message should be blocked")
	}
	if retryAfter <= 0 {
		t.Fatalf("expected positive retryAfter, got %d", retryAfter)
	}
}

func TestRateLimiterDifferentUsers(t *testing.T) {
	rl := newRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < rl.maxBurst; i++ {
		if ok, _ := rl.Allow("user-a", fmt.Sprintf("user a message %d", i), now); !ok {
			t.Fatalf("user-a blocked too early on send %d", i+1)
		}
		if ok, _ := rl.Allow("user-b", fmt.Sprintf("user b message %d", i), now); !ok {
			t.Fatalf("user-b blocked too early on send %d", i+1)
		}
	}
}

func TestRateLimiterDuplicates(t *testing.T) {
	rl := newRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	if ok, _ := rl.Allow("user-1", "  hi   there ", now); !ok {
		t.Fatal("first send should pass")
	}
	if ok, _ := rl.Allow("user-1", "hi there", now.Add(time.Second)); !ok {
		t.Fatal("second identical send should pass")
	}
	ok, retryAfter := rl.Allow("user-1", "hi there", now.Add(2*time.Second))
	if ok {
		t.Fatal("third identical send should be blocked")
	}
	if retryAfter <= 0 {
		t.Fatalf("expected positive retryAfter, got %d", retryAfter)
	}
}

func TestRateLimiterCooldownExpires(t *testing.T) {
	rl := newRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < rl.maxBurst; i++ {
		rl.Allow("user-1", fmt.Sprintf("message %d", i), now)
	}
	_, retryAfter := rl.Allow("user-1", "blocked now", now)
	if retryAfter <= 0 {
		t.Fatal("expected cooldown")
	}
	ok, _ := rl.Allow("user-1", "fresh start", now.Add(time.Duration(retryAfter+1)*time.Second))
	if !ok {
		t.Fatal("send after cooldown should pass with a fresh window")
	}
}

func TestRateLimiterEscalatingBackoff(t *testing.T) {
	rl := newRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	var previous int
	for i := 0; i < 3; i++ {
		for j := 0; j < rl.maxBurst; j++ {
			rl.Allow("user-1", fmt.Sprintf("round %d msg %d", i, j), now)
		}
		_, retryAfter := rl.Allow("user-1", fmt.Sprintf("blocked %d", i), now)
		if retryAfter <= previous {
			t.Fatalf("cooldown should escalate, round %d got %d (previous %d)", i, retryAfter, previous)
		}
		previous = retryAfter
		now = now.Add(time.Duration(retryAfter+1) * time.Second)
	}
}

func TestNormalise(t *testing.T) {
	if got := normalise("  a \t\n  b c "); got != "a b c" {
		t.Fatalf("normalise mismatch: %q", got)
	}
}
