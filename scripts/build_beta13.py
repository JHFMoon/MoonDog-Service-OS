import json,base64,hashlib,pathlib
r=pathlib.Path(__file__).resolve().parents[1]
old='0.10.18-beta.12';new='0.10.18-beta.13'
p=json.loads((r/f'updates/packages/moondog-{old}.json').read_text())
for name in ('assets/app.js','assets/daily-engine.js'):
 t=(r/name).read_text()
 if name=='assets/app.js':t=t.replace('const VERSION = "0.10.17";',f'const VERSION = "{new}";',1)
 f=next(x for x in p['files'] if x['path']==name)
 f['contentBase64']=base64.b64encode(t.encode()).decode()
 f['sha256']=hashlib.sha256(t.encode()).hexdigest()
p['version']=new
b=(json.dumps(p,indent=2)+'\n').encode()
(r/f'updates/packages/moondog-{new}.json').write_bytes(b)
m=json.loads((r/'updates/manifest.json').read_text())
m['beta'].update(version=new,packageUrl=f'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-{new}.json',sha256=hashlib.sha256(b).hexdigest(),releaseNotes='Respect completed RO reviews until their saved follow-up date unless priority escalates. Source refreshes do not re-request already planned work. No Workspace migration.')
(r/'updates/manifest.json').write_text(json.dumps(m,indent=2)+'\n')
