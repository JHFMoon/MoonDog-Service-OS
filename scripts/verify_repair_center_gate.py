#!/usr/bin/env python3
"""Fail-closed exact-main and required-check gate for the public Repair Center.

This does not publish Stable, install software or access any dealership Workspace.
"""
import json
import os
import re
import subprocess
import sys
import time

REPO = "JHFMoon/MoonDog-Service-OS"
REQUIRED = ("publication-check.yml", "public-history-safety-audit.yml")
HEX_SHA = re.compile(r"^[0-9a-f]{40}$")


def gh_api(endpoint):
    result = subprocess.run(
        ["gh", "api", "-X", "GET", endpoint],
        capture_output=True, text=True, check=True, timeout=30,
    )
    return json.loads(result.stdout)


def head_matches(repo, sha):
    response = gh_api(f"repos/{repo}/git/ref/heads/main")
    return response.get("object", {}).get("sha") == sha


def choose_run(runs, sha):
    matches = [item for item in runs if item.get("head_sha") == sha
               and item.get("event") == "push"]
    return max(matches, key=lambda x: (x.get("created_at", ""), x.get("id", 0)), default=None)


def run_state(run):
    if not run:
        return "waiting"
    if run.get("status") != "completed":
        return "waiting"
    return "success" if run.get("conclusion") == "success" else "failure"


def verify_event(expected):
    event = os.environ.get("GITHUB_EVENT_NAME")
    if event == "workflow_run":
        values = {
            "head": os.environ.get("TRIGGER_HEAD_SHA"),
            "branch": os.environ.get("TRIGGER_HEAD_BRANCH"),
            "event": os.environ.get("TRIGGER_EVENT"),
            "conclusion": os.environ.get("TRIGGER_CONCLUSION"),
            "name": os.environ.get("TRIGGER_NAME"),
        }
        if values != {
            "head": expected,
            "branch": "main",
            "event": "push",
            "conclusion": "success",
            "name": "Public Repository History Safety Audit",
        }:
            raise RuntimeError("Automatic trigger did not prove a successful main push history audit.")
    elif event != "workflow_dispatch":
        raise RuntimeError("Unsupported publication trigger.")


def verify(repo, expected, *, attempts=45, interval=20, sleeper=time.sleep):
    if repo != REPO or not HEX_SHA.fullmatch(expected):
        raise RuntimeError("Wrong repository or invalid SHA.")
    if os.environ.get("GITHUB_REF_NAME") != "main":
        # For workflow_run, GitHub supplies default branch; for manual runs, only main is accepted.
        raise RuntimeError("Publication must target main.")
    verify_event(expected)
    checked = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                             text=True, check=True, timeout=10).stdout.strip()
    if checked != expected:
        raise RuntimeError("Checked-out source does not match the triggering commit.")

    for index in range(attempts):
        if not head_matches(repo, expected):
            raise RuntimeError("Main advanced; never deploy an older site revision.")
        states = {}
        for workflow in REQUIRED:
            result = gh_api(
                f"repos/{repo}/actions/workflows/{workflow}/runs"
                f"?head_sha={expected}&event=push&per_page=30"
            )
            selected = choose_run(result.get("workflow_runs", []), expected)
            states[workflow] = run_state(selected)
        if "failure" in states.values():
            raise RuntimeError("Required main verification failed: " + json.dumps(states))
        if all(state == "success" for state in states.values()):
            print(f"Safe to build Repair Center for verified main SHA {expected}", flush=True)
            return
        if index + 1 < attempts:
            sleeper(interval)
    raise RuntimeError("Required exact-head workflows were not verified before the bounded deadline.")


def main():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    sha = os.environ.get("EXPECTED_SHA", "")
    try:
        verify(repo, sha)
    except (OSError, ValueError, subprocess.CalledProcessError, RuntimeError) as error:
        print("Repair Center publication BLOCKED: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
