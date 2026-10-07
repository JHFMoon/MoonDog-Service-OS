"""Regenerate updater-compatible runtime bundles from generic public source.

Installed 0.10.9+ update clients authorize a fixed list of existing runtime paths.
Do not add new runtime script URLs until a separately validated updater transition.
This generator keeps the canonical first-party source in src/ and embeds it in
existing allowlisted files, without copying protected Workspace data.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLES = (
    ("src/refresh-intelligence.js", "assets/freshness.js",
     "// BEGIN GENERATED REFRESH INTELLIGENCE (see src/refresh-intelligence.js)",
     "// END GENERATED REFRESH INTELLIGENCE"),
    ("src/meeting-presenter.js", "assets/daily-ops.js",
     "// BEGIN GENERATED MEETING PRESENTER (see src/meeting-presenter.js)",
     "// END GENERATED MEETING PRESENTER"),
    ("src/meeting-presenter.css", "assets/meeting.css",
     "/* BEGIN GENERATED MEETING LAYOUT (see src/meeting-presenter.css) */",
     "/* END GENERATED MEETING LAYOUT */"),
)


def desired_text(source, name):
    value = source.rstrip()
    if name == "src/refresh-intelligence.js":
        statement = '  if(typeof module!=="undefined")module.exports=api;\n'
        if statement not in value:
            raise ValueError("CommonJS source export is missing; stop before changing runtime")
        value = value.replace(statement, "")
    return value.rstrip()


def generate(check=False):
    changes = []
    for src, dest, start, end in BUNDLES:
        source = (ROOT / src).read_text(encoding="utf-8")
        target = ROOT / dest
        existing = target.read_text(encoding="utf-8")
        if existing.count(start) != 1 or existing.count(end) != 1:
            raise ValueError(f"{dest}: exactly one generated block is required")
        begin = existing.index(start) + len(start)
        finish = existing.index(end, begin)
        result = existing[:begin] + "\n" + desired_text(source, src) + "\n" + existing[finish:]
        if result != existing:
            changes.append(dest)
            if not check:
                target.write_text(result, encoding="utf-8", newline="\n")
    if check and changes:
        raise SystemExit("Generated runtime drift: " + ", ".join(changes) +
                         ". Run python3 scripts/build_operating_modules.py and commit the runtime files.")
    print("Operating modules synchronized." if not changes else
          ("Out-of-sync: " + ", ".join(changes) if check else "Updated: " + ", ".join(changes)))


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true", help="Fail if existing bundle differs")
    generate(check=p.parse_args().check)
