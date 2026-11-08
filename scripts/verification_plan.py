#!/usr/bin/env python3
"""Conservative exact-tree verification scope. Execute only the base copy in CI.

This changes functional-test applicability, never privacy/history checks or merge
risk. Shared runtime and unknown inputs keep the entire functional/browser proof.
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
from pathlib import Path

PROTECTED_DOCS = frozenset({
    'docs/RELEASE-AUTHORIZATION.md', 'docs/RELEASE-PROCESS.md',
    'docs/DATA-PRESERVATION-FIRST-BETA-POLICY.md', 'docs/DATA-BOUNDARY.md',
    'docs/SOURCE-OF-TRUTH.md', 'docs/ROADMAP-ACCEPTANCE-MATRIX.md',
    'docs/SOURCE-AUTHORITY-INVENTORY.md',
})
PACKAGE = re.compile(r'updates/packages/moondog-\d+\.\d+\.\d+-beta\.\d+\.json\Z')
SHA = re.compile(r'[0-9a-f]{40}\Z')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL)


def document(path):
    return (path in {'README.md', 'CHANGELOG.md'} or
            path.startswith('docs/') and path.endswith('.md') and path not in PROTECTED_DOCS)


def plan(root: Path, base: str, head: str) -> dict:
    result = {'schemaVersion': 1, 'base': base, 'head': head, 'scope': 'full',
              'reason': 'Unknown or shared/protected inputs require complete verification.'}
    try:
        if not SHA.fullmatch(base) or not SHA.fullmatch(head):
            return result
        # A stable, complete tree diff covers renames as deletion + addition and
        # never relies on API pagination, patch truncation, filenames in a PR body,
        # or a mapping supplied by candidate tests.
        for revision in (base, head):
            if git(root, 'rev-parse', '--verify', revision+'^{commit}').decode().strip() != revision:
                return result
        if git(root, 'merge-base', base, head).decode().strip() != base:
            return result
        raw = git(root, 'diff', '--no-renames', '--name-only', '-z', base, head)
        paths = raw.decode('utf-8', 'strict').split('\0')[:-1]
        if not paths or any(not p or '\\' in p or any(s in {'', '.', '..'} for s in p.split('/')) for p in paths):
            return result
        # Restrict narrowed scopes to ordinary blobs. A symlink/submodule or
        # mode change cannot turn a document into a trusted runtime input.
        for revision in (base, head):
            for entry in git(root, 'ls-tree', '-r', '-z', revision, '--', *paths).split(b'\0'):
                if entry and entry.split(b' ', 2)[:2] != [b'100644', b'blob']:
                    return result
        if all(document(p) for p in paths):
            result.update(scope='documentation', reason='Only non-policy Markdown documents changed; executable and package inputs are identical.')
        elif 'updates/manifest.json' in paths and all(document(p) or p == 'updates/manifest.json' or PACKAGE.fullmatch(p) for p in paths):
            old = json.loads(git(root, 'show', base+':updates/manifest.json'))
            new = json.loads(git(root, 'show', head+':updates/manifest.json'))
            if (isinstance(old, dict) and isinstance(new, dict) and
                isinstance(old.get('stable'), dict) and old['stable'] == new.get('stable')):
                result.update(scope='package-metadata', reason='Beta metadata only; unchanged software/test/dependency inputs. Package contracts and installation still run.')
    except (OSError, ValueError, subprocess.CalledProcessError):
        pass
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--github-output', type=Path)
    args = parser.parse_args()
    result = plan(args.root, args.base, args.head)
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2)+'\n')
    if args.github_output:
        with args.github_output.open('a') as out:
            out.write('scope='+result['scope']+'\n')
    print('Verification scope: '+result['scope']+'; privacy and history checks remain mandatory.')


if __name__ == '__main__':
    main()
