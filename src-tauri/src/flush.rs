//! Small, testable state machine for close/quit flush acknowledgments.
//!
//! The Tauri layer owns the windows; this module only tracks which window has a
//! pending flush request and whether every window acknowledged a quit request.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Condvar, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct FlushCoordinator {
    next_id: AtomicU64,
    close_pending: Mutex<HashMap<String, u64>>,
    force_close: Mutex<HashSet<String>>,
    quit: Mutex<Option<QuitRequest>>,
    quit_cv: Condvar,
}

struct QuitRequest {
    id: u64,
    pending: HashSet<String>,
}

impl FlushCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns a request id, or None when a close flush is already pending for
    /// this window (a repeated Alt+F4 must not start a second handshake).
    pub fn begin_close(&self, label: &str) -> Option<u64> {
        let mut pending = self.close_pending.lock().unwrap();
        if pending.contains_key(label) {
            return None;
        }
        let id = self.next_id();
        pending.insert(label.to_string(), id);
        Some(id)
    }

    /// True only when the acknowledgment matches the outstanding request.
    pub fn complete_close(&self, label: &str, request_id: u64) -> bool {
        let mut pending = self.close_pending.lock().unwrap();
        match pending.get(label) {
            Some(id) if *id == request_id => {
                pending.remove(label);
                true
            }
            _ => false,
        }
    }

    /// Removes a timed-out close request. Returns false if it already acked.
    pub fn timeout_close(&self, label: &str, request_id: u64) -> bool {
        self.complete_close(label, request_id)
    }

    pub fn mark_force_close(&self, label: &str) {
        self.force_close.lock().unwrap().insert(label.to_string());
    }

    pub fn take_force_close(&self, label: &str) -> bool {
        self.force_close.lock().unwrap().remove(label)
    }

    pub fn begin_quit(&self, labels: impl IntoIterator<Item = String>) -> u64 {
        let id = self.next_id();
        let pending = labels.into_iter().collect();
        *self.quit.lock().unwrap() = Some(QuitRequest { id, pending });
        id
    }

    /// Marks one window as flushed for the quit request. A close acknowledgment
    /// also satisfies a pending quit request for that window.
    pub fn complete_quit(&self, label: &str, request_id: u64) -> bool {
        let mut guard = self.quit.lock().unwrap();
        let Some(request) = guard.as_mut() else {
            return false;
        };
        if request.id != request_id {
            return false;
        }
        let removed = request.pending.remove(label);
        if request.pending.is_empty() {
            self.quit_cv.notify_all();
        }
        removed
    }

    pub fn complete_quit_for_label(&self, label: &str) -> bool {
        let mut guard = self.quit.lock().unwrap();
        let Some(request) = guard.as_mut() else {
            return false;
        };
        let removed = request.pending.remove(label);
        if request.pending.is_empty() {
            self.quit_cv.notify_all();
        }
        removed
    }

    /// Waits until every window acknowledges or the timeout elapses.
    /// Returns true when the wait timed out with windows still pending.
    pub fn wait_for_quit(&self, request_id: u64, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut guard = self.quit.lock().unwrap();

        loop {
            let Some(request) = guard.as_ref() else {
                return false;
            };
            if request.id != request_id || request.pending.is_empty() {
                return false;
            }

            let now = Instant::now();
            if now >= deadline {
                return true;
            }
            let (next_guard, _) = self
                .quit_cv
                .wait_timeout(guard, deadline.saturating_duration_since(now))
                .unwrap();
            guard = next_guard;
        }
    }

    pub fn cancel_quit(&self) {
        *self.quit.lock().unwrap() = None;
        self.quit_cv.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_request_is_unique_and_gated_by_ack() {
        let coordinator = FlushCoordinator::new();
        let id = coordinator.begin_close("note-a").expect("first close");
        assert!(coordinator.begin_close("note-a").is_none());
        assert!(!coordinator.complete_close("note-a", id + 999));
        assert!(coordinator.complete_close("note-a", id));
        assert!(!coordinator.complete_close("note-a", id));
    }

    #[test]
    fn close_timeout_only_removes_the_matching_request() {
        let coordinator = FlushCoordinator::new();
        let id = coordinator.begin_close("note-a").expect("close request");
        assert!(!coordinator.timeout_close("note-a", id + 1));
        assert!(coordinator.timeout_close("note-a", id));
        assert!(!coordinator.complete_close("note-a", id));
    }

    #[test]
    fn force_close_flag_is_single_use() {
        let coordinator = FlushCoordinator::new();
        coordinator.mark_force_close("note-a");
        assert!(coordinator.take_force_close("note-a"));
        assert!(!coordinator.take_force_close("note-a"));
    }

    #[test]
    fn quit_wait_finishes_when_all_windows_ack() {
        let coordinator = FlushCoordinator::new();
        let id = coordinator.begin_quit(vec!["a".to_string(), "b".to_string()]);
        assert!(coordinator.wait_for_quit(id, Duration::from_millis(1)));
        assert!(coordinator.complete_quit("a", id));
        assert!(coordinator.complete_quit("b", id));
        assert!(!coordinator.wait_for_quit(id, Duration::from_secs(1)));
    }

    #[test]
    fn quit_timeout_reports_pending_windows() {
        let coordinator = FlushCoordinator::new();
        let id = coordinator.begin_quit(vec!["a".to_string()]);
        assert!(coordinator.wait_for_quit(id, Duration::from_millis(20)));
        assert!(coordinator.complete_quit_for_label("a"));
        assert!(!coordinator.wait_for_quit(id, Duration::from_millis(20)));
    }

    #[test]
    fn cancelling_quit_allows_the_app_to_keep_running() {
        let coordinator = FlushCoordinator::new();
        let id = coordinator.begin_quit(vec!["a".to_string()]);
        coordinator.cancel_quit();
        assert!(!coordinator.wait_for_quit(id, Duration::from_millis(20)));
        assert!(!coordinator.complete_quit("a", id));
    }
}
