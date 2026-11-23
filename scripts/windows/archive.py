"""Build and verify a portable Windows ZIP using the standard library."""
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

app_dir, output = (Path(arg).resolve() for arg in sys.argv[1:])
if not (app_dir / 'BlueDaFeiYu.exe').is_file():
    raise RuntimeError('The Windows application must exist.')

with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for source in sorted(app_dir.rglob('*')):
        if source.is_file():
            archive.write(source, (Path(app_dir.name) / source.relative_to(app_dir)).as_posix())

with ZipFile(output) as archive:
    invalid = archive.testzip()
    if invalid is not None:
        raise RuntimeError(f'Corrupt archive entry: {invalid}')
print(f'Verified Windows ZIP: {output.name}')
