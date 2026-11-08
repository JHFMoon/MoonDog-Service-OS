import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from scripts.verify_distribution_vendor import verify

class VendorCacheIntegrityTests(unittest.TestCase):
    def test_valid_outputs_pass_and_any_tampering_missing_file_or_source_override_blocks(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'distribution').mkdir();generated=root/'cache';generated.mkdir()
            outputs={'jszip.min.js':b'synthetic jszip','xlsx.full.min.js':b'synthetic sheetjs',
                     'pdf.min.js':b'synthetic pdf','pdf.worker.min.js':b'synthetic worker'}
            hashes={k:hashlib.sha256(v).hexdigest()for k,v in outputs.items()}
            contract={'schemaVersion':1,'runtimeLibraries':{
                'jszip':{'outputSha256':hashes['jszip.min.js']},
                'sheetjs':{'outputSha256':hashes['xlsx.full.min.js']},
                'pdfjs':{'mainOutputSha256':hashes['pdf.min.js'],'workerOutputSha256':hashes['pdf.worker.min.js']}}}
            (root/'distribution/dependencies.json').write_text(json.dumps(contract))
            for name,value in outputs.items():(generated/name).write_bytes(value)
            self.assertEqual(verify(root,generated),4)
            for name,value in outputs.items():
                (generated/name).write_bytes(b'damaged')
                with self.assertRaises(ValueError):verify(root,generated)
                (generated/name).unlink()
                with self.assertRaises(OSError):verify(root,generated)
                (generated/name).write_bytes(value)
            (root/'vendor').mkdir();(root/'vendor/jszip.min.js').write_bytes(b'foreign source override')
            with self.assertRaises(ValueError):verify(root,generated)

if __name__=='__main__':unittest.main()
