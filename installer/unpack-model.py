"""Extract a hash-verified model tarball without external tar/bzip2 executables."""
import pathlib
import shutil
import sys
import tarfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination).resolve()
root.mkdir(parents=True, exist_ok=True)
seen = set()
total = 0
with tarfile.open(archive, "r|bz2") as bundle:
    for member in bundle:
        name = member.name.replace("\\", "/")
        if not name or ":" in name or name.startswith("/") or ".." in name.split("/"):
            raise ValueError("Unsafe model path")
        target = root.joinpath(name)
        if not target.resolve().is_relative_to(root) or not (member.isfile() or member.isdir()):
            raise ValueError("Unsafe model entry")
        current = target
        while current != root:
            if current.is_symlink():
                raise ValueError("Linked model destination")
            current = current.parent
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        key = str(target).casefold()
        if key in seen:
            raise ValueError("Duplicate model file")
        seen.add(key)
        total += member.size
        if total > 4_000_000_000 or member.size > 2_000_000_000:
            raise ValueError("Model archive too large")
        target.parent.mkdir(parents=True, exist_ok=True)
        with bundle.extractfile(member) as source, target.open("wb") as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
print("Model extracted safely")
