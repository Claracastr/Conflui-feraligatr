"""Processo externo. Envia observações HTTP, sem acesso direto ao banco."""

import argparse, time
from datetime import datetime, timezone
import httpx
from .config import settings
from .cli import CATALOG, synthetic


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--interval", type=float, default=5)
    p.add_argument("--once", action="store_true")
    args = p.parse_args()
    if not settings.ingest_key or settings.data_mode != "simulator":
        raise SystemExit("Configure INGEST_KEY e DATA_MODE=simulator")
    with httpx.Client(
        base_url=args.url, headers={"X-Ingest-Key": settings.ingest_key}, timeout=15
    ) as client:
        while True:
            at = datetime.now(timezone.utc).replace(microsecond=0)
            for s in CATALOG["sectors"]:
                payload = synthetic(s, at)
                for attempt in range(3):
                    try:
                        r = client.post("/observations", json=payload)
                        r.raise_for_status()
                        break
                    except httpx.HTTPError:
                        if attempt == 2:
                            raise
                        time.sleep(1)
            print("18 setores enviados:", at.isoformat())
            if args.once:
                return
            time.sleep(max(1, args.interval))


if __name__ == "__main__":
    main()
