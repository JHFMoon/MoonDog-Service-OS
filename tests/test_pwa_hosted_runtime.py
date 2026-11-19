"""Synthetic-only tests for proposed protected public-runtime staging.
No private-store data or real Stable channel changes.
"""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'src/pwa/prepare_hosted_runtime.py'
spec = importlib.util.spec_from_file_location('pwa_hosted_runtime', SCRIPT)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
PREFIX='Service Operations Dashboard/'

class HostedRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)

    def fixture(self, *, extra=None, manifest_extra=None, wrong_hash=False, bad_version=False):
        extra=extra or {}
        files={'00 - OPEN DASHBOARD.html':b'<html>launcher</html>',
               'System Files/index.html':b'<html>actual dashboard</html>',
               'System Files/assets/app.js':b'const source=true;',
               'System Files/Workspace/README.txt':b'Empty workspace only',}
        for name in host.VENDOR:files['System Files/'+name]=b'synthetic vendor '+name.encode()
        for i in range(12):files['System Files/assets/styles%d.css'%i]=b'a{}'
        files.update(extra)
        records=[{'path':p,'size':len(v),'sha256':host.sha256(v)} for p,v in sorted(files.items())]
        manifest={'format':host.FORMAT,'formatVersion':1,'version':'0.10.17' if not bad_version else '0.10.18',
                  'packageRoot':host.ROOT_NAME,'launcher':'00 - OPEN DASHBOARD.html',
                  'applicationRoot':'System Files','workspaceRoot':'System Files/Workspace',
                  'updateChannel':'stable','workspaceProtectedFromUpdates':True,
                  'files':records}
        manifest.update(manifest_extra or {})
        zip_path=self.base/'source.zip'
        with zipfile.ZipFile(zip_path,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for p,v in files.items():z.writestr(PREFIX+p,v)
            z.writestr(PREFIX+'INSTALLATION-MANIFEST.json',json.dumps(manifest))
        metadata=self.base/'release.json'
        metadata.write_text(json.dumps({'version':'0.10.17','sha256':('0'*64 if wrong_hash else host.sha256(zip_path.read_bytes()))}))
        return zip_path,metadata

    def test_verified_public_runtime_is_copied_without_workspace(self):
        a,b=self.fixture()
        target=self.base/'pwa'
        info=host.publish_verified(a,b,target)
        self.assertEqual(info['version'],'0.10.17')
        self.assertFalse(info['workspaceHosted'])
        self.assertFalse(info['operationalReady'])
        self.assertTrue((target/'index.html').exists())
        self.assertTrue((target/'assets/app.js').exists())
        self.assertTrue((target/'vendor/pdf.min.js').exists())
        self.assertFalse((target/'Workspace').exists())
        self.assertFalse((target/'00 - OPEN DASHBOARD.html').exists())
        self.assertEqual(host.sha256((target/'assets/app.js').read_bytes()),host.sha256(b'const source=true;'))

    def test_bad_checksum_refused_before_writing(self):
        a,b=self.fixture(wrong_hash=True)
        with self.assertRaisesRegex(host.Refused,'checksum'):
            host.publish_verified(a,b,self.base/'pwa')
        self.assertFalse((self.base/'pwa').exists())

    def test_bad_version_refused(self):
        a,b=self.fixture(bad_version=True)
        with self.assertRaisesRegex(host.Refused,'identity'):
            host.publish_verified(a,b,self.base/'pwa')

    def test_no_private_files_are_even_copied(self):
        a,b=self.fixture(extra={'System Files/Workspace/data/ro.json':b'synthetic but private'})
        with self.assertRaisesRegex(host.Refused,'Store-private'):
            host.publish_verified(a,b,self.base/'pwa')
        self.assertFalse((self.base/'pwa').exists())

    def test_unsafe_and_duplicate_archive_paths_refused(self):
        for path in ('System Files/assets/../private.json','System Files/assets/CON','System Files/assets/name\\bad.js'):
            with self.subTest(path=path):
                a,b=self.fixture(extra={path:b'invalid'})
                with self.assertRaisesRegex(host.Refused,'unsafe'):
                    host.publish_verified(a,b,self.base/'pwa')

    def test_unlisted_file_refused(self):
        a,b=self.fixture()
        with zipfile.ZipFile(a,'a') as z:z.writestr(PREFIX+'System Files/assets/surprise.js',b'sneak')
        b.write_text(json.dumps({'version':'0.10.17','sha256':host.sha256(a.read_bytes())}))
        with self.assertRaisesRegex(host.Refused,'unapproved'):
            host.publish_verified(a,b,self.base/'pwa')

    def test_existing_target_preserved(self):
        a,b=self.fixture()
        target=self.base/'pwa';target.mkdir();(target/'keep.txt').write_text('do not change')
        with self.assertRaisesRegex(host.Refused,'existing published'):
            host.publish_verified(a,b,target)
        self.assertEqual((target/'keep.txt').read_text(),'do not change')

    def test_tampered_manifest_file_hash_refused(self):
        a,b=self.fixture()
        with zipfile.ZipFile(a,'a') as z:z.writestr(PREFIX+'System Files/assets/app.js',b'changed')
        b.write_text(json.dumps({'version':'0.10.17','sha256':host.sha256(a.read_bytes())}))
        with self.assertRaisesRegex(host.Refused,'duplicate'):
            host.publish_verified(a,b,self.base/'pwa')

if __name__=='__main__':unittest.main()