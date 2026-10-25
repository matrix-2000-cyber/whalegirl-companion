import io
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'unpack-model.py'

class ExtractionTests(unittest.TestCase):
    def extract(self, name, kind=tarfile.REGTYPE):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            archive = root / 'model.tar.bz2'
            with tarfile.open(archive, 'w:bz2') as bundle:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                entry.linkname = '../outside'
                entry.size = 3 if kind == tarfile.REGTYPE else 0
                bundle.addfile(entry, io.BytesIO(b'abc'))
            result = subprocess.run([sys.executable, str(SCRIPT), str(archive), str(root/'out')], capture_output=True)
            if result.returncode == 0:
                self.assertEqual((root/'out/model/tokens.txt').read_bytes(), b'abc')
            self.assertFalse((root/'outside').exists())
            return result.returncode

    def test_valid_file(self):
        self.assertEqual(self.extract('model/tokens.txt'), 0)

    def test_unsafe_paths_and_links(self):
        for name, kind in [('../outside',tarfile.REGTYPE), ('C:/outside',tarfile.REGTYPE), ('link',tarfile.SYMTYPE), ('hard',tarfile.LNKTYPE)]:
            with self.subTest(name=name):
                self.assertNotEqual(self.extract(name,kind),0)

if __name__ == '__main__':
    unittest.main()
