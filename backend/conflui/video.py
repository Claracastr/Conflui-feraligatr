"""PoC opcional: YOLO pré-treinado + ByteTrack, ocupação por quadro amostrado.
Não mede visitantes únicos ou passagens entre câmeras. Não salva vídeo.
"""

import argparse, json, time, uuid
from datetime import datetime, timezone
import httpx
from .config import settings
from .cli import CATALOG, inside


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="Arquivo ou índice de webcam, ex. 0")
    p.add_argument("--camera", required=True)
    p.add_argument("--sector", required=True)
    p.add_argument("--model", default="yolo11n.pt")
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--homography", help="JSON 3x3, validado na calibração da câmera")
    p.add_argument("--interval", type=float, default=5)
    a = p.parse_args()
    if settings.data_mode != "video" or not settings.ingest_key:
        raise SystemExit("Use banco separado, DATA_MODE=video e INGEST_KEY configurada")
    import cv2
    import numpy as np
    from ultralytics import YOLO

    model = YOLO(a.model)
    cap = cv2.VideoCapture(int(a.input) if a.input.isdigit() else a.input)
    if not cap.isOpened():
        raise SystemExit("Não foi possível abrir a fonte de vídeo")
    H = (
        np.array(json.loads(open(a.homography).read()), dtype=float)
        if a.homography
        else None
    )
    last = 0
    try:
        with httpx.Client(
            base_url=a.url, headers={"X-Ingest-Key": settings.ingest_key}, timeout=20
        ) as client:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                result = model.track(
                    frame,
                    persist=True,
                    classes=[0],
                    tracker="bytetrack.yaml",
                    verbose=False,
                )[0]
                # Occupancy = detections present now, never accumulated across frames.
                boxes = (
                    result.boxes.xyxy.cpu().numpy() if result.boxes is not None else []
                )
                if time.monotonic() - last < a.interval:
                    continue
                last = time.monotonic()
                positions = []
                region = next(
                    (s for s in CATALOG["sectors"] if s["id"] == a.sector), None
                )
                for x1, y1, x2, y2 in boxes:
                    if H is not None:
                        point = cv2.perspectiveTransform(
                            np.array([[[(x1 + x2) / 2, y2]]], dtype=np.float32), H
                        )[0, 0]
                        if (
                            0 <= point[0] <= 1000
                            and 0 <= point[1] <= 734
                            and region
                            and inside(float(point[0]), float(point[1]), region["poly"])
                        ):
                            positions.append(
                                {"x": float(point[0]), "y": float(point[1])}
                            )
                payload = {
                    "observation_id": str(uuid.uuid4()),
                    "camera_id": a.camera,
                    "sector_id": a.sector,
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                    "count": len(positions) if H is not None else len(boxes),
                    "positions": positions,
                    "coordinate_system": "map_1000x734" if H is not None else "none",
                    "source": "video",
                    "status": "available",
                }
                for attempt in range(3):
                    try:
                        response = client.post("/observations", json=payload)
                        response.raise_for_status()
                        break
                    except httpx.HTTPError:
                        if attempt == 2:
                            raise
                        time.sleep(1)
                print("Ocupação observada:", payload["count"])
    finally:
        cap.release()


if __name__ == "__main__":
    main()
