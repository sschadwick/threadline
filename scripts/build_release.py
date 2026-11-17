"""Build the downloadable Threadline zipapp and its SHA-256 checksum."""

import hashlib
import runpy
import tempfile
import zipapp
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = {"index.html", "app.js", "style.css"}


def include(path):
    if path.as_posix() in {"LICENSE", "threadline", "threadline/web"}:
        return True
    if path.parent == Path("threadline"):
        return path.suffix == ".py"
    return path.parent == Path("threadline/web") and path.name in ASSETS


def main():
    version = runpy.run_path(str(ROOT / "threadline" / "__init__.py"))["__version__"]
    out = ROOT / "dist" / f"threadline-{version}.pyz"
    out.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as build_dir:
        archive = Path(build_dir) / out.name
        zipapp.create_archive(ROOT, archive, main="threadline.server:main", compressed=True, filter=include)
        archive.replace(out)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    out.with_suffix(".pyz.sha256").write_text(f"{digest}  {out.name}\n", encoding="ascii")
    print(out.relative_to(ROOT))


if __name__ == "__main__":
    main()
