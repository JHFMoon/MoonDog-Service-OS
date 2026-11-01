#!/usr/bin/env python3
"""Redacted audit of public GitHub surfaces outside reachable Git blobs."""
from __future__ import annotations
import collections, io, json, os, re, subprocess, sys, tempfile, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib

from build_distribution import WORKSPACE_README
from audit_surface_retry import (DownloadFailure, classify_api_failure,
                                 is_gone_action_artifact_download, retry_transient,
                                 safe_api_operation)

REPO=os.environ["GITHUB_REPOSITORY"]
counts=collections.Counter()
safe=collections.Counter()
diagnostics=collections.Counter()
email_sources=collections.Counter()
email_unique=set()
email_unique_by_source=collections.defaultdict(set)
email_source_item_count=collections.Counter()
email_personal_domains={b"gmail.com",b"googlemail.com",b"yahoo.com",b"hotmail.com",b"outlook.com",b"live.com",b"icloud.com",b"aol.com"}

patterns={
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider_token": re.compile(rb"(?i)(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{20,}|npm_[0-9A-Za-z]{20,}|sk_live_[A-Za-z0-9]{16,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})"),
    "credential_assignment": re.compile(rb"(?im)^.{0,100}(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_-]{16,}"),
}
email_rx=re.compile(rb"(?i)\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b")
safe_email_addresses={b"web-flow@github.com",b"noreply@github.com"}
safe_email_domains={b"noreply.github.com",b"users.noreply.github.com",b"example.com",b"example.org",b"example.net"}
vin_rx=re.compile(rb"\b[A-HJ-NPR-Z0-9]{17}\b")
ssn_rx=re.compile(rb"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
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

# One exact, independently inspected pinned PDF.js worker bundle. This only
# exempts its already-public vendor attribution, never arbitrary vendor paths.
VETTED_PDF_WORKER_SHA256="df20aeb7d05ee7246889f25f1e2bc882c6264b042a8b4148cdc563dc3c553691"

def is_vetted_pdf_vendor_attribution(name: str, data: bytes) -> bool:
    normalized=name.replace("\\\\","/")
    return (
        normalized.endswith("/System Files/vendor/pdf.worker.min.js")
        and hashlib.sha256(data).hexdigest()==VETTED_PDF_WORKER_SHA256
    )

def scan_bytes(data: bytes, label: str, approved_vendor_attribution: bool=False):
    # Only fixed source categories enter public summaries, never release names,
    # archive paths, issue bodies, comment text, or other untrusted labels.
    label=label.split(":",1)[0]
    if label not in {
        "release-metadata","release-asset-name","release","artifact",
        "action-artifact-name","issue","issue-comment","pr-review-comment","pr-review",
    }:
        label="other"
    for kind,rx in patterns.items():
        if rx.search(data):
            counts[kind]+=1
    matched_emails={
        m.group(0).lower() for m in email_rx.finditer(data)
        if m.group(1).lower() not in safe_email_domains and m.group(0).lower() not in safe_email_addresses
    }
    if matched_emails and approved_vendor_attribution:
        safe["verified_public_pdfjs_attribution"]+=1
    elif matched_emails:
        counts["unsafe_email"]+=1
        email_source_item_count[label]+=1
        for email in matched_emails:
            email_unique.add(email)
            email_unique_by_source[label].add(email)
            domain=email.split(b"@",1)[1]
            category="personal_provider" if domain in email_personal_domains else "other_domain"
            email_sources[label+"_"+category+"_occurrences"]+=1
    elif email_rx.search(data):
        safe["known_public_or_synthetic_email"]+=1
    if any(valid_vin(m.group(0)) for m in vin_rx.finditer(data)):
        counts["valid_vin"]+=1
    if ssn_rx.search(data):
        counts["ssn_candidate"]+=1

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
        if info.file_size>20_000_000:
            counts["oversize_archive_member"]+=1
            continue
        body=zf.read(info)
        if workspace_name.search(name):
            if info.file_size==0 and Path(name).name in {".gitkeep",".keep",".empty"}:
                safe["empty_workspace_placeholder"]+=1
            elif name.endswith("/System Files/Workspace/README.txt") and body == WORKSPACE_README.encode("utf-8"):
                safe["verified_distribution_workspace_readme"]+=1
            else:
                counts["workspace_file_in_archive"]+=1
                if info.file_size==0:
                    counts["empty_workspace_file_requires_review"]+=1
                else:
                    counts["nonempty_workspace_file_requires_review"]+=1
        if zipfile.is_zipfile(io.BytesIO(body)):
            scan_zip_bytes(body,f"{source}!{name}",depth+1)
        else:
            scan_bytes(body,f"{source}!{name}",approved_vendor_attribution=is_vetted_pdf_vendor_attribution(name,body))

def redacted_api_failure(endpoint: str, category: str, *, parse_failure: bool=False):
    operation=safe_api_operation(endpoint)
    counts["api_response_parse_failure" if parse_failure else "api_request_failure"]+=1
    diagnostics["api_failure_"+category]+=1
    diagnostics["api_operation_"+operation]+=1
    status_path=os.environ.get("PUBLIC_SURFACE_AUDIT_STATUS")
    if status_path:
        report={
            "counts":dict(counts),
            "safe_counts":dict(safe),
            "diagnostics":dict(diagnostics),
            "redacted":True,
            "partial":True,
            "failedOperation":operation,
            "failureCategory":category,
        }
        Path(status_path).write_text(json.dumps(report,sort_keys=True),encoding="utf-8")
    print(f"Public-surface audit failed closed: operation={operation}, category={category}; response details suppressed.")
    raise SystemExit(1)


def gh_json(endpoint: str):
    def api_read():
        try:
            proc=subprocess.run(
                ["gh","api","--paginate",endpoint],
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,
            )
        except OSError:
            raise DownloadFailure("transport_failure") from None
        if proc.returncode!=0:
            raise DownloadFailure(classify_api_failure(proc.stderr))
        return proc.stdout.decode("utf-8","replace")

    try:
        raw=retry_transient(api_read,reset=lambda:None).strip()
    except DownloadFailure as error:
        redacted_api_failure(endpoint,error.status)

    if not raw:
        return []
    # --paginate can concatenate JSON arrays. jq is avoided so values never print.
    decoder=json.JSONDecoder()
    pos=0; items=[]
    try:
        while pos<len(raw):
            while pos<len(raw) and raw[pos].isspace(): pos+=1
            if pos>=len(raw): break
            value,end=decoder.raw_decode(raw,pos)
            pos=end
            items.extend(value if isinstance(value,list) else [value])
    except (json.JSONDecodeError, ValueError):
        redacted_api_failure(endpoint,"invalid_json",parse_failure=True)
    return items

def gh_download(endpoint: str, target: Path):
    """Follow release/artifact redirects; fail closed after bounded transient retries.

    The GitHub CLI does not reliably stream binary redirects. Never expose
    tokens, signed URLs, response bodies, or matched values in logs.
    """
    token=os.environ.get("GH_TOKEN","")
    if not token:
        raise DownloadFailure("auth_missing")
    accept="application/octet-stream" if "/releases/assets/" in endpoint else "application/vnd.github+json"

    def download_once():
        result=subprocess.run(
            ["curl","--silent","--location","--output",str(target),
             "--write-out","%{http_code}","--connect-timeout","20","--max-time","120",
             "--header","Accept: "+accept,
             "--header","X-GitHub-Api-Version: 2022-11-28",
             "--header","Authorization: Bearer "+token,
             "https://api.github.com/"+endpoint],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=False,
        )
        code=result.stdout.decode("ascii","replace").strip()
        if result.returncode!=0:
            raise DownloadFailure(code if code in {"408","429","500","502","503","504"} else "transport_failure")
        if code!="200":
            raise DownloadFailure(code if code.isdigit() else "transport_failure")
        if not target.is_file():
            raise DownloadFailure("missing_file")

    retry_transient(download_once, reset=lambda: target.unlink(missing_ok=True))


# Release metadata and assets.
releases=gh_json(f"repos/{REPO}/releases?per_page=100")
for release in releases:
    for text in [release.get("name"),release.get("body"),release.get("tag_name")]:
        if text:
            scan_bytes(str(text).encode(), "release-metadata")
    for asset in release.get("assets") or []:
        name=str(asset.get("name") or "")
        scan_bytes(name.encode("utf-8","replace"),"release-asset-name")
        if restricted_name.search(name):
            counts["restricted_release_asset_name"]+=1
        with tempfile.TemporaryDirectory(prefix="surface-release-") as td:
            path=Path(td)/"asset"
            try:
                gh_download(f"repos/{REPO}/releases/assets/{asset['id']}",path)
            except DownloadFailure as error:
                counts["release_asset_download_failure"]+=1
                counts["release_asset_http_"+error.status]+=1
                continue
            data=path.read_bytes()
            if len(data)>100_000_000:
                counts["oversize_release_asset"]+=1
            elif name.lower().endswith(".zip"):
                if not zipfile.is_zipfile(io.BytesIO(data)):
                    counts["release_zip_invalid_or_api_metadata"]+=1
                else:
                    scan_zip_bytes(data,f"release:{name}")
            elif zipfile.is_zipfile(io.BytesIO(data)):
                scan_zip_bytes(data,f"release:{name}")
            else:
                scan_bytes(data,f"release:{name}")

# Current non-expired Actions artifacts.
artifact_pages=gh_json(f"repos/{REPO}/actions/artifacts?per_page=100")
artifacts=[]
for page in artifact_pages:
    if isinstance(page,dict) and isinstance(page.get("artifacts"),list):
        artifacts.extend(page["artifacts"])
    elif isinstance(page,dict) and page.get("id"):
        artifacts.append(page)
for artifact in artifacts:
    if artifact.get("expired"):
        safe["expired_action_artifact"]+=1
        continue
    name=str(artifact.get("name") or "")
    scan_bytes(name.encode("utf-8","replace"),"action-artifact-name")
    if restricted_name.search(name):
        counts["restricted_action_artifact_name"]+=1
    with tempfile.TemporaryDirectory(prefix="surface-artifact-") as td:
        path=Path(td)/"artifact.zip"
        try:
            gh_download(f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip",path)
        except DownloadFailure as error:
            # The Actions artifact endpoint returns 410 when the listed artifact
            # is no longer downloadable (expired or removed between listing and
            # download). Its name was scanned above and no archive bytes exist
            # to inspect, so record this unavailable item separately. All other
            # download failures remain blocking.
            if is_gone_action_artifact_download(error.status):
                safe["unavailable_action_artifact_410"]+=1
                continue
            counts["action_artifact_download_failure"]+=1
            counts["action_artifact_http_"+error.status]+=1
            continue
        data=path.read_bytes()
        if len(data)>100_000_000:
            counts["oversize_action_artifact"]+=1
        elif not zipfile.is_zipfile(io.BytesIO(data)):
            counts["action_artifact_invalid_or_api_metadata"]+=1
        else:
            scan_zip_bytes(data,f"artifact:{name}")

# Public issue/PR bodies and comments. Use repository-wide endpoints so the audit
# stays bounded as PR history grows; values are never logged.
issues=gh_json(f"repos/{REPO}/issues?state=all&per_page=100")
for issue in issues:
    for text in [issue.get("title"),issue.get("body")]:
        if text:
            scan_bytes(str(text).encode(),"issue")

issue_comments=gh_json(f"repos/{REPO}/issues/comments?per_page=100")
for comment in issue_comments:
    if comment.get("body"):
        scan_bytes(str(comment["body"]).encode(),"issue-comment")

review_comments=gh_json(f"repos/{REPO}/pulls/comments?per_page=100")
for comment in review_comments:
    if comment.get("body"):
        scan_bytes(str(comment["body"]).encode(),"pr-review-comment")

# Review submissions are separate from review comments and can contain
# public text. Fetch every PR's full paginated review history with bounded
# concurrency; consume and scan responses in repository order on this thread.
# Failure of ANY endpoint still propagates and fails the entire audit closed.
review_submission_count=0
review_numbers=[issue.get("number") for issue in issues
                if "pull_request" in issue and issue.get("number")]

def fetch_reviews(number):
    return gh_json(f"repos/{REPO}/pulls/{number}/reviews?per_page=100")

with ThreadPoolExecutor(max_workers=4) as review_pool:
    for reviews in review_pool.map(fetch_reviews,review_numbers):
        for review in reviews:
            review_submission_count+=1
            if review.get("body"):
                scan_bytes(str(review["body"]).encode(),"pr-review")


# Redacted provenance: no addresses, domains, paths or match excerpts are emitted.
diagnostics["distinct_candidate_email_addresses"]=len(email_unique)
diagnostics["candidate_email_sources"]=len(email_unique_by_source)
for label, items in email_unique_by_source.items():
    diagnostics["email_distinct_"+label]=len(items)
for label, n in email_source_item_count.items():
    diagnostics["email_items_"+label]=n
for label, n in email_sources.items():
    diagnostics["email_"+label]=n

report={"counts":dict(counts),"safe_counts":dict(safe),"diagnostics":dict(diagnostics),"releases":len(releases),"artifacts":len(artifacts),"issues":len(issues),"issueComments":len(issue_comments),"reviewComments":len(review_comments),"reviewSubmissions":review_submission_count}
status_path=os.environ.get("PUBLIC_SURFACE_AUDIT_STATUS")
if status_path:
    Path(status_path).write_text(json.dumps(report,sort_keys=True),encoding="utf-8")

summary=["## Public GitHub surface audit","",f"Releases scanned: {len(releases)}",f"Actions artifacts enumerated: {len(artifacts)}",f"Issues/PRs enumerated: {len(issues)}",f"Issue comments enumerated: {len(issue_comments)}",f"PR review comments enumerated: {len(review_comments)}",f"PR review submissions enumerated: {review_submission_count}","", "| Candidate category | Count |","|---|---:|"]
summary += [f"| {k} | {counts[k]} |" for k in sorted(counts)]
summary += ["", "**Review required** — candidates are redacted and are not proof of exposure." if counts else "No blocking candidates detected on scanned public surfaces."]
if safe:
    summary += ["","Known public/synthetic items and artifacts unavailable with HTTP 410 were counted separately; unavailable artifact contents were not retrievable."]
if os.environ.get("GITHUB_STEP_SUMMARY"):
    with open(os.environ["GITHUB_STEP_SUMMARY"],"a",encoding="utf-8") as f:
        f.write("\n".join(summary)+"\n")

print(f"Public surfaces scanned: releases={len(releases)} artifacts={len(artifacts)} issues={len(issues)} issue_comments={len(issue_comments)} review_comments={len(review_comments)} review_submissions={review_submission_count}")
for k in sorted(counts):
    print(f"  {k}: {counts[k]}")
for k in sorted(diagnostics):
    print(f"  diagnostic_{k}: {diagnostics[k]}")
if counts:
    print("REVIEW REQUIRED: public-surface candidates detected; values were not printed.")
    sys.exit(1)
print("No blocking public-surface candidates detected.")
