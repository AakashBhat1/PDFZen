from server import _safe_stem

def test_safe_stem_basic():
    assert _safe_stem("document.pdf") == "document"
    assert _safe_stem("my-cool-doc_123.pdf") == "my-cool-doc_123"

def test_safe_stem_none_or_empty():
    assert _safe_stem(None) == "document"
    assert _safe_stem("") == "document"

def test_safe_stem_traversal():
    assert _safe_stem("../../etc/passwd.pdf") == "passwd"
    assert _safe_stem("C:\\Windows\\System32\\cmd.exe.pdf") == "cmdexe"

def test_safe_stem_characters():
    assert _safe_stem("hello.world.pdf") == "helloworld"
    assert _safe_stem("hello!@#$%^&*()_+world.pdf") == "hello_world"
    assert _safe_stem("   spaces   .pdf") == "spaces"

def test_safe_stem_control_chars():
    assert _safe_stem("\x00test\n\r.pdf") == "test"
