#!/usr/bin/env python3
"""
Download Israeli supermarket price XML files without Docker.

Requires:
  pip install il-supermarket-scraper

Then:
  python scripts/download-supermarket-dumps.py
  npm run sync:prices
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# il-supermarket-scraper imports fcntl (Unix-only). No-op shim for Windows.
if sys.platform == "win32":
    import types

    _fcntl = types.ModuleType("fcntl")
    _fcntl.LOCK_EX = 2
    _fcntl.LOCK_UN = 8
    _fcntl.flock = lambda _f, _op: None
    sys.modules["fcntl"] = _fcntl

ROOT = Path(__file__).resolve().parent.parent
DUMPS = Path(os.environ.get("SUPERMARKET_DUMPS_DIR", ROOT / "data" / "supermarket-dumps"))
ENABLED = os.environ.get("ENABLED_SCRAPERS", "SHUFERSAL,RAMI_LEVY,HAZI_HINAM")
LIMIT = os.environ.get("SCRAPER_LIMIT")
LIMIT_INT = int(LIMIT) if LIMIT and LIMIT.isdigit() else 3


def main() -> int:
    DUMPS.mkdir(parents=True, exist_ok=True)

    try:
        from il_supermarket_scarper import ScarpingTask, ScraperFactory
    except ImportError as e:
        print(
            "Cannot load il-supermarket-scraper.\n"
            "  npm run scraper:setup\n"
            f"  ({e})",
            file=sys.stderr,
        )
        return 1

    keys = [k.strip() for k in ENABLED.split(",") if k.strip()]
    enabled = []
    factory_names = {s.name: s for s in ScraperFactory}
    for key in keys:
        if key in factory_names:
            enabled.append(key)
        else:
            print(f"Warning: unknown scraper {key!r}, skipped", file=sys.stderr)

    if not enabled:
        print("No valid scrapers in ENABLED_SCRAPERS", file=sys.stderr)
        return 1

    print(f"Dumps → {DUMPS}")
    print(f"Scrapers: {', '.join(enabled)}")
    print(f"Limit: {LIMIT_INT} file(s) per chain")

    scraper = ScarpingTask(
        enabled_scrapers=enabled,
        output_configuration={
            "output_mode": "disk",
            "base_storage_path": str(DUMPS),
        },
        status_configuration={
            "database_type": "json",
            "base_path": str(DUMPS / ".status"),
        },
        multiprocessing=1,
    )

    scraper.start(limit=LIMIT_INT)
    scraper.join()
    print("Done. Run: npm run sync:prices")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
