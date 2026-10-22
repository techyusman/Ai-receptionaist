"""Set the clone column (and a note) for rows of replica/features.csv by feature name.

    python replica/update_features.py "Feature name=yes|note" "Other feature=partial|note"

Unknown names fail loudly, so a renamed row is never silently skipped.
"""
import csv
import sys

PATH = "replica/features.csv"

with open(PATH, encoding="utf-8", newline="") as fh:
    rows = list(csv.DictReader(fh))
names = {r["feature"]: r for r in rows}

for arg in sys.argv[1:]:
    name, _, rest = arg.partition("=")
    value, _, note = rest.partition("|")
    if name not in names:
        sys.exit(f"no feature named {name!r}")
    if value not in ("yes", "partial", "no", "skip"):
        sys.exit(f"bad value {value!r} for {name!r}")
    names[name]["clone"] = value
    if note:
        # Keep the recon note, replace any earlier "built:" note.
        recon_note = names[name]["notes"].split("built: ")[0].rstrip("; ")
        names[name]["notes"] = f"{recon_note}; built: {note}" if recon_note else f"built: {note}"

with open(PATH, "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=["feature", "area", "priority", "original", "clone", "notes"], lineterminator="\n")
    w.writeheader()
    w.writerows(rows)

done = sum(1 for r in rows if r["clone"] == "yes")
part = sum(1 for r in rows if r["clone"] == "partial")
must = [r for r in rows if r["priority"] == "must" and r["clone"] != "skip"]
must_done = sum(1 for r in must if r["clone"] == "yes")
must_part = sum(1 for r in must if r["clone"] == "partial")
print(f"{len(sys.argv) - 1} rows updated. clone yes={done} partial={part}. must-haves: {must_done} yes + {must_part} partial of {len(must)}")
