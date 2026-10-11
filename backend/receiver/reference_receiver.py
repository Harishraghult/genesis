"""Reference BLE receiver. Requires an authorized room receiver token and real BLE hardware.

Install optional dependencies: pip install bleak httpx
Set FOCUSLOCK_API, FOCUSLOCK_RECEIVER_ID, FOCUSLOCK_RECEIVER_TOKEN,
FOCUSLOCK_SESSION_ID. No RSSI, device address, or scan history is submitted.
"""
import asyncio
import os
from datetime import datetime, timezone

import httpx
from bleak import BleakScanner


async def main():
    base = os.environ["FOCUSLOCK_API"].rstrip("/")
    receiver = os.environ["FOCUSLOCK_RECEIVER_ID"]
    token = os.environ["FOCUSLOCK_RECEIVER_TOKEN"]
    session = int(os.environ["FOCUSLOCK_SESSION_ID"])
    if not base.startswith("https://") and base not in ("http://127.0.0.1:8000", "http://localhost:8000"):
        raise SystemExit("Receiver API requires HTTPS outside localhost development")
    headers = {"Authorization": f"Bearer {token}"}
    seen_in_scan = set()
    async with httpx.AsyncClient(timeout=5) as client:
        async def submit(value, seen_at):
            try:
                response = await client.post(f"{base}/receivers/{receiver}/sightings", headers=headers,
                    json={"session_id": session, "token": value, "seen_at": seen_at})
                if response.status_code not in (201, 409, 422, 410):
                    print(f"Receiver submission status {response.status_code}")
            except httpx.HTTPError:
                print("Receiver network unavailable; evidence reduced")

        def detected(_device, advertisement):
            for value in advertisement.service_uuids or []:
                if value.lower().startswith("f10c0c10-") and value not in seen_in_scan:
                    seen_in_scan.add(value)
                    asyncio.create_task(submit(value, datetime.now(timezone.utc).isoformat()))

        async with BleakScanner(detection_callback=detected):
            while True:
                seen_in_scan.clear()
                try:
                    response = await client.post(f"{base}/receivers/{receiver}/heartbeat", headers=headers)
                    if response.status_code != 200:
                        print(f"Receiver heartbeat rejected: {response.status_code}")
                except httpx.HTTPError:
                    print("Receiver network unavailable; evidence reduced")
                await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(main())
