import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
import atomicfile


def test_retries_then_succeeds(tmp_path, monkeypatch):
    calls = {'n': 0}
    real = os.replace

    def flaky(a, b):
        calls['n'] += 1
        if calls['n'] < 4:
            raise PermissionError(5, 'Access is denied')
        return real(a, b)

    monkeypatch.setattr(atomicfile.os, 'replace', flaky)
    monkeypatch.setattr(atomicfile.time, 'sleep', lambda s: None)
    p = tmp_path / 'x.state.json'
    atomicfile.write_text_atomic(p, '{"a":1}')
    assert p.read_text() == '{"a":1}' and calls['n'] == 4
    assert not (tmp_path / 'x.state.json.tmp').exists()


def test_permanent_lock_falls_back_to_direct_write(tmp_path, monkeypatch):
    def locked(a, b):
        raise PermissionError(5, 'Access is denied')

    monkeypatch.setattr(atomicfile.os, 'replace', locked)
    monkeypatch.setattr(atomicfile.time, 'sleep', lambda s: None)
    p = tmp_path / 's.json'
    atomicfile.write_text_atomic(p, 'hello')
    assert p.read_text() == 'hello'


def test_best_effort_never_raises(tmp_path):
    atomicfile.write_text_atomic(tmp_path / 'missing' / 's.json', 'x', best_effort=True)
