#!/usr/bin/env python3
"""Redacted audit of public GitHub surfaces outside reachable Git blobs."""
from __future__ import annotations
import collections, io, json, os, re, subprocess, sys, tempfile, zipfile
from pathlib import Path

REPO=os.environ["GITHUB_REPOSITORY"]
counts=collections.Counter()
safe=collections.Counter()

patterns={
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider_token": re.compile(rb"(?i)(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,})"),
    "credential_assignment": re.compile(rb"(?im)^.{0,100}(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_-]{16,}"),
}
email_rx=re.compile(rb"(?i)\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b")
safe_email_domains={b"users.noreply.github.com",b"example.com",b"example.org",b"example.net"}
vin_rx=re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b")
restricted_name=re.compile(r"(?i)(?:^|/)(?:customers?|employees?|contacts?|reports?|exports?|repair.orders?|store.data|operational.data|files to learn|drop reports here)(?:/|$)")
workspace_name=re.compile(r"(?i)(?:^|/)workspace(?:/|$)")

vin_values={**{str(i):i for i in range(10)}}
for letters,values in [
    ("ABCDEFGH",range(1,9)),
    ("JKLMNPR",[1,2,3,4,5,7,9]),
    ("STUVWXYZ",[2,3,4,5,6,7,8,9]),
]:
    vin_values.update(dict(zip(letters,values)))
vin_weights=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]

def valid_vin(raw: bytes)->bool:
    try:
        vin=raw.decode("ascii")
        total=sum(vin_values[ch]*weight for ch,weight in zip(vin,vin_weights))
    except (KeyError,UnicodeDecodeError):
        return False
    check="X" if total%11==10 else str(total%11)
    return vin[8]==check

def scan_bytes(data: bytes, label: str):
    for kind,rx in patterns.items():
        if rx.search(data):
            counts[kind]+=1
    bad_email=False
    for m in email_rx.finditer(data):
        if m.group(1).lower() not in safe_email_domains:
            bad_email=True
            break
    if bad_email:
        counts["unsafe_email"]+=1
    elif email_rx.search(data):
        safe["known_public_or_synthetic_email"]+=1
    if any(valid_vin(m.group(0)) for m in vin_rx.finditer(data)):
        counts["valid_vin"]+=1

def scan_zip_bytes(data: bytes, source: str, depth: int=0):
    if depth>1:
        counts["nested_archive_uninspected"]+=1
        return
    try:
        zf=zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        scan_bytes(data,source)
        return
    for info in zf.infolist():
        name=info.filename.replace("\\","/")
        if info.is_dir():
            continue
        if restricted_name.search(name):
            counts["restricted_path_in_archive"]+=1
        if workspace_name.search(name):
            counts["workspace_file_in_archive"]+=1
        if info.file_size>20_000_000:
            counts["oversize_archive_member"]+=1
            continue
        body=zf.read(info)
        if zipfile.is_zipfile(io.BytesIO(body)):
            scan_zip_bytes(body,f"{source}!{name}",depth+1)
        else:
            scan_bytes(body,f"{source}!{name}")

def gh_json(endpoint: str):
    proc=subprocess.run(["gh","api","--paginate",endpoint],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    raw=proc.stdout.decode("utf-8","replace").strip()
    if not raw:
        return []
    # --paginate can concatenate JSON arrays. jq is avoided so values never print.
    decoder=json.JSONDecoder()
    pos=0; items=[]
    while pos<len(raw):
        while pos<len(raw) and raw[pos].isspace(): pos+=1
        if pos>=len(raw): break
        value,end=decoder.raw_decode(raw,pos)
        pos=end
        items.extend(value if isinstance(value,list) else [value])
    return items

def gh_download(endpoint: str, target: Path):
    with target.open("wb") as out:
        subprocess.run(["gh","api","-H","Accept: application/octet-stream",endpoint],stdout=out,stderr=subprocess.DEVNULL,check=True)

# Release metadata and assets.
releases=gh_json(f"repos/{REPO}/releases?per_page=100")
for release in releases:
    for text in [release.get("name"),release.get("body"),release.get("tag_name")]:
        if text:
            scan_bytes(str(text).encode(), "release-metadata")
    for asset in release.get("assets") or []:
        name=str(asset.get("name") or "")
        if restricted_name.search(name):
            counts["restricted_release_asset_name"]+=1
        with tempfile.TemporaryDirectory(prefix="surface-release-") as td:
            path=Path(td)/"asset"
            try:
                gh_download(f"repos/{REPO}/releases/assets/{asset['id']}",path)
            except subprocess.CalledProcessError:
                counts["release_asset_download_failure"]+=1
                continue
            data=path.read_bytes()
            if len(data)>100_000_000:
                counts["oversize_release_asset"]+=1
            elif zipfile.is_zipfile(io.BytesIO(data)):
                scan_zip_bytes(data,f"release:{name}")
            else:
                scan_bytes(data,f"release:{name}")

# Current non-expired Actions artifacts.
artifacts=gh_json(f"repos/{REPO}/actions/artifacts?per_page=100")
for artifact in artifacts:
    if artifact.get("expired"):
        safe["expired_action_artifact"]+=1
        continue
    name=str(artifact.get("name") or "")
    if restricted_name.search(name):
        counts["restricted_action_artifact_name"]+=1
    with tempfile.TemporaryDirectory(prefix="surface-artifact-") as td:
        path=Path(td)/"artifact.zip"
        try:
            gh_download(f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip",path)
        except subprocess.CalledProcessError:
            counts["action_artifact_download_failure"]+=1
            continue
        data=path.read_bytes()
        if len(data)>100_000_000:
            counts["oversize_action_artifact"]+=1
        else:
            scan_zip_bytes(data,f"artifact:{name}")

# Public issue/PR bodies and comments. High-risk matches only; values are never logged.
issues=gh_json(f"repos/{REPO}/issues?state=all&per_page=100")
for issue in issues:
    for text in [issue.get("title"),issue.get("body")]:
        if text:
            scan_bytes(str(text).encode(),"issue")
    number=issue.get("number")
    if not number:
        continue
    for comment in gh_json(f"repos/{REPO}/issues/{number}/comments?per_page=100"):
        if comment.get("body"):
            scan_bytes(str(comment["body"]).encode(),"issue-comment")
    if "pull_request" in issue:
        for review in gh_json(f"repos/{REPO}/pulls/{number}/reviews?per_page=100"):
            if review.get("body"):
                scan_bytes(str(review["body"]).encode(),"pr-review")
        for comment in gh_json(f"repos/{REPO}/pulls/{number}/comments?per_page=100"):
            if comment.get("body"):
                scan_bytes(str(comment["body"]).encode(),"pr-review-comment")

report={"counts":dict(counts),"safe_counts":dict(safe),"releases":len(releases),"artifacts":len(artifacts),"issues":len(issues)}
status_path=os.environ.get("PUBLIC_SURFACE_AUDIT_STATUS")
if status_path:
    Path(status_path).write_text(json.dumps(report,sort_keys=True),encoding="utf-8")

summary=["## Public GitHub surface audit","",f"Releases scanned: {len(releases)}",f"Actions artifacts enumerated: {len(artifacts)}",f"Issues/PRs enumerated: {len(issues)}","", "| Candidate category | Count |","|---|---:|"]
summary += [f"| {k} | {counts[k]} |" for k in sorted(counts)]
summary += ["", "**Review required** — candidates are redacted and are not proof of exposure." if counts else "No blocking candidates detected on scanned public surfaces."]
if safe:
    summary += ["","Known public/synthetic or expired items were counted separately."]
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:
        f.write("\n".join(summary)+"\n")

print(f"Public surfaces scanned: releases={len(releases)} artifacts={len(artifacts)} issues={len(issues)}")
for k in sorted(counts):
    print(f"  {k}: {counts[k]}")
if counts:
    print("REVIEW REQUIRED: public-surface candidates detected; values were not printed.")
    sys.exit(1)
print("No blocking public-surface candidates detected.")
