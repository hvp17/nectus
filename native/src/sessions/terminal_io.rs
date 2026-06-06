//! Low-level terminal-write helpers shared across the session runtime.
//!
//! `write_agent_submission` submits an app-authored line into a PTY: it writes
//! the text, flushes, waits a beat, then sends a separate Enter. Used for the
//! initial agent prompt and `submit_input` (`mod.rs`) and for forwarding review
//! feedback to a running worker (`review_loop.rs`).

use std::io::Write;
use std::time::Duration;

const TERMINAL_SUBMIT_KEY_DELAY: Duration = Duration::from_millis(60);

pub(super) fn write_agent_submission(writer: &mut dyn Write, input: &str) -> std::io::Result<()> {
    writer.write_all(input.as_bytes())?;
    // Raw-mode TUIs can treat text plus Enter delivered in one burst as pasted text.
    writer.flush()?;
    std::thread::sleep(TERMINAL_SUBMIT_KEY_DELAY);
    writer.write_all(b"\r")?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[derive(Debug, PartialEq)]
    enum WriteEvent {
        Write(Vec<u8>),
        Flush,
    }

    #[derive(Default)]
    struct RecordingWriter {
        events: Vec<WriteEvent>,
    }

    impl Write for RecordingWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.events.push(WriteEvent::Write(buf.to_vec()));
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            self.events.push(WriteEvent::Flush);
            Ok(())
        }
    }

    #[test]
    fn writes_agent_submission_with_terminal_enter() {
        let mut output = Vec::new();

        write_agent_submission(&mut output, "Line 1\nLine 2").unwrap();

        assert_eq!(output, b"Line 1\nLine 2\r");
    }

    #[test]
    fn flushes_agent_submission_before_sending_terminal_enter() {
        let mut output = RecordingWriter::default();

        write_agent_submission(&mut output, "Create the pull request").unwrap();

        assert_eq!(
            output.events,
            [
                WriteEvent::Write(b"Create the pull request".to_vec()),
                WriteEvent::Flush,
                WriteEvent::Write(b"\r".to_vec()),
                WriteEvent::Flush,
            ]
        );
    }
}
