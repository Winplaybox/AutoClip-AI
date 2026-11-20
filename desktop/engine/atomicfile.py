"""Crash-safe small-file writes that survive Windows file locking.

On Windows, os.replace() raises PermissionError (WinError 5/32) when another
process (Defender, Search indexer, a backup tool) briefly holds the target
open. Retry with short backoff, then fall back to a direct write. Callers that
only persist a cache of in-memory state may pass best_effort=True so a locked
file never aborts real work.
"""
import os
import time
from pathlib import Path

_RETRIES = 12
_DELAY = 0.05


def replace_retry(src, dst):
    """os.replace with retry on transient Windows locking errors."""
    last = None
    for i in range(_RETRIES):
        try:
            os.replace(src, dst)
            return
        except PermissionError as e:
            last = e
            time.sleep(min(_DELAY * (i + 1), 0.5))
    raise last


def write_text_atomic(path, text, encoding='utf-8', best_effort=False):
    path = Path(path)
    tmp = path.with_name(path.name + '.tmp')
    try:
        tmp.write_text(text, encoding=encoding)
        try:
            replace_retry(tmp, path)
        except PermissionError:
            # Last resort: overwrite in place (not atomic, but better than failing).
            path.write_text(text, encoding=encoding)
    except OSError:
        if not best_effort:
            raise
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
