import json,base64,hashlib,pathlib
r=pathlib.Path(__file__).resolve().parents[1]
old='0.10.18-beta.15';new='0.10.18-beta.16'
p=json.loads((r/f'updates/packages/moondog-{old}.json').read_text())
assert p['version']==old
for name in ('assets/app.js','assets/daily-ops.js'):
 t=(r/name).read_text()
 if name=='assets/app.js':
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
m['beta'].update(version=new,packageUrl=f'https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/main/updates/packages/moondog-{new}.json',sha256=hashlib.sha256(b).hexdigest(),releaseNotes='Skip all ROs for the selected advisor in the current day Manager Attention rotation, with undo. Preserves ROs and future dates. No Workspace migration.')
(r/'updates/manifest.json').write_text(json.dumps(m,indent=2)+'\n')
