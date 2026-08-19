from l3m_ai.main import READY_FILE


def test_ready_file_uses_temporary_directory() -> None:
    assert READY_FILE.parent.as_posix() == "/tmp"
