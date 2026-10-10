import json,base64,hashlib,pathlib
r=pathlib.Path(__file__).resolve().parents[1]
old='0.10.18-beta.16';new='0.10.18-beta.17'
p=json.loads((r/f'updates/packages/moondog-{old}.json').read_text())
assert p['version']==old
for name in ('assets/app.js',):
 t=(r/name).read_text()
 previous='const VERSION = "0.10.17";'
 assert previous in t
 t=t.replace(previous,f'const VERSION = "{new}";',1)
 f=next(x for x in p['files'] if x['path']==name)
 f['contentBase64']=base64.b64encode(t.encode()).decode()
 f['sha256']=hashlib.sha256(t.encode()).hexdigest()
p['version']=new
b=(json.dumps(p,indent=2)+'\n').encode()
(r/f'updates/packages/moondog-{new}.json').write_bytes(b)
m=json.loads((r/'updates/manifest.json').read_text())
assert m['beta']['version']==old
m['beta'].update(version=new,packageUrl=f'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-{new}.json',sha256=hashlib.sha256(b).hexdigest(),releaseNotes='Render Home before optional source scans, Files To Learn reconciliation, backup and month-end checks; work continues after first paint. No Workspace migration.')
(r/'updates/manifest.json').write_text(json.dumps(m,indent=2)+'\n')
