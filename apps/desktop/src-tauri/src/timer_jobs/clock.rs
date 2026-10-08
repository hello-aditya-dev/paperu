//! Injectable clock for the Timer Jobs scheduler.
//!
//! The scheduler depends on an abstract `Clock` so tests can advance
//! time deterministically without sleeping. Production uses
//! `SystemClock` (real `chrono::Utc::now()`).

use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};

/// An injectable wall clock. Implementations must be Send + Sync.
pub trait Clock: Send + Sync {
    /// The current instant.
    fn now(&self) -> DateTime<Utc>;
}

/// The real system clock. Used in production.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A test clock with a manually-settable current time. Cheap to clone
/// so multiple components (the scheduler + assertions) can share it.
#[derive(Clone)]
pub struct TestClock {
    now: Arc<Mutex<DateTime<Utc>>>,
}

impl TestClock {
    pub fn new(initial: DateTime<Utc>) -> Self {
        Self {
            now: Arc::new(Mutex::new(initial)),
        }
    }
    pub fn advance(&self, dur: chrono::Duration) {
        let mut g = self.now.lock().expect("TestClock poisoned");
        *g += dur;
    }
    pub fn set(&self, t: DateTime<Utc>) {
        let mut g = self.now.lock().expect("TestClock poisoned");
        *g = t;
    }
}

impl Clock for TestClock {
    fn now(&self) -> DateTime<Utc> {
        *self.now.lock().expect("TestClock poisoned")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clock_advances() {
        let t0 = Utc::now();
        let c = TestClock::new(t0);
        assert_eq!(c.now(), t0);
        c.advance(chrono::Duration::hours(3));
        assert_eq!(c.now(), t0 + chrono::Duration::hours(3));
    }

    #[test]
    fn test_clock_clones_share_state() {
        let c1 = TestClock::new(Utc::now());
        let c2 = c1.clone();
        c1.advance(chrono::Duration::minutes(5));
        assert_eq!(c1.now(), c2.now());
    }

    #[test]
    fn system_clock_returns_recent_time() {
        let before = Utc::now();
        let c = SystemClock;
        let now = c.now();
        let after = Utc::now();
        assert!(now >= before && now <= after);
    }
}
