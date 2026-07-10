#!/usr/bin/env python3
"""Загрузка геометрии/атрибутов участков из API НСПД.

Эндпоинт:
  https://nspd.gov.ru/api/geoportal/v2/search/geoportal
    ?thematicSearchId=1&query=<кадастр>&CRS=EPSG:4326

Запуск (нужен доступ к nspd.gov.ru — обычно российский IP):
  python3 scripts/fetch_nspd.py
  python3 scripts/fetch_nspd.py --proxy http://user:pass@host:port
  NSPD_PROXY=http://host:port python3 scripts/fetch_nspd.py

Обновляет data/plots.json: lat/lon (центроид), polygon, area_m2 (если есть),
address, geo_source=nspd.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLOTS = ROOT / "data" / "plots.json"
OUT_RAW = ROOT / "data" / "nspd_raw"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def api_url(cadastre: str) -> str:
    return (
        "https://nspd.gov.ru/api/geoportal/v2/search/geoportal"
        f"?thematicSearchId=1&query={cadastre}&CRS=EPSG:4326"
    )


def fetch(url: str, proxy: str | None, timeout: int = 25) -> bytes:
    handlers = []
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://nspd.gov.ru/map",
            "Origin": "https://nspd.gov.ru",
        },
    )
    # context only for direct; opener.open doesn't take context kw
    if proxy:
        with opener.open(req, timeout=timeout) as r:
            return r.read()
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read()


def centroid(geom: dict) -> tuple[float, float] | None:
    if not geom:
        return None
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    pts = []

    def walk(node):
        if not isinstance(node, (list, tuple)):
            return
        if len(node) >= 2 and isinstance(node[0], (int, float)) and isinstance(node[1], (int, float)):
            pts.append((float(node[0]), float(node[1])))
            return
        for x in node:
            walk(x)

    walk(coords)
    if not pts:
        return None
    lon = sum(p[0] for p in pts) / len(pts)
    lat = sum(p[1] for p in pts) / len(pts)
    return lat, lon


def pick_props(feature: dict) -> dict:
    props = feature.get("properties") or {}
    # НСПД кладёт полезные поля по-разному — собираем всё плоским словарём
    flat = dict(props)
    opts = props.get("options") if isinstance(props.get("options"), dict) else {}
    flat.update(opts)
    return flat


def extract_area_m2(props: dict) -> float | None:
    keys = (
        "specified_area",
        "declared_area",
        "area",
        "area_value",
        "land_record_area",
        "square",
        "площадь",
    )
    for k in keys:
        for src in (props,):
            if k in src and src[k] not in (None, ""):
                try:
                    v = float(str(src[k]).replace(",", ".").replace(" ", ""))
                    if v > 0:
                        # иногда приходит в сотках — эвристика: < 500 и целое «как сотки» редко; оставляем как м² если > 50
                        return v
                except ValueError:
                    pass
    return None


def extract_address(props: dict) -> str:
    for k in ("readable_address", "address", "location", "address_okato", "label"):
        v = props.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def esri_photos(lat: float, lon: float) -> list:
    photos = []
    for (w, h), pad in ((("800", "500"), 0.0035), (("1200", "700"), 0.008), (("1600", "900"), 0.02)):
        bbox = f"{lon-pad},{lat-pad},{lon+pad},{lat+pad}"
        url = (
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
            f"?bbox={bbox}&bboxSR=4326&imageSR=4326&size={w},{h}&format=jpg&f=image"
        )
        photos.append({"url": url, "source": "esri"})
    return photos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy", default=os.environ.get("NSPD_PROXY") or "")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.7)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    proxy = args.proxy.strip() or None

    # connectivity probe
    probe = "https://nspd.gov.ru/api/geoportal/v2/search/geoportal?thematicSearchId=1&query=77:01:0001001:1&CRS=EPSG:4326"
    print("probe NSPD...", "proxy=" + (proxy or "direct"))
    try:
        body = fetch(probe, proxy, timeout=20)
        print("probe OK, bytes", len(body))
    except Exception as e:
        print("НСПД недоступен:", type(e).__name__, e)
        print("Нужен российский IP / VPN / прокси: --proxy http://host:port")
        return 2

    plots = json.loads(PLOTS.read_text(encoding="utf-8"))
    OUT_RAW.mkdir(parents=True, exist_ok=True)
    ok = fail = 0
    todo = plots[: args.limit] if args.limit else plots

    for i, p in enumerate(todo, 1):
        cad = p["cadastre"]
        print(f"[{i}/{len(todo)}] {cad}", flush=True)
        try:
            raw = fetch(api_url(cad), proxy)
            data = json.loads(raw.decode("utf-8"))
            (OUT_RAW / f"{cad.replace(':','_')}.json").write_bytes(raw)
            features = (data.get("data") or {}).get("features") or data.get("features") or []
            if not features:
                print("  empty")
                fail += 1
                time.sleep(args.sleep)
                continue
            feat = features[0]
            props = pick_props(feat)
            geom = feat.get("geometry") or {}
            c = centroid(geom)
            if not c:
                print("  no centroid")
                fail += 1
                time.sleep(args.sleep)
                continue
            lat, lon = c
            area = extract_area_m2(props)
            addr = extract_address(props)
            if not args.dry_run:
                p["lat"] = round(lat, 6)
                p["lon"] = round(lon, 6)
                p["geo_source"] = "nspd"
                p["geo_name"] = addr or p.get("settlement") or p.get("geo_name")
                p["polygon"] = geom
                p["nspd_props"] = {k: props[k] for k in list(props)[:40]}
                if addr and not (p.get("place") or "").strip():
                    p["place"] = addr
                if area and area > 10:
                    # если похоже на м²
                    if area < 5:  # слишком мало для м² — возможно га
                        pass
                    else:
                        p["area_m2"] = float(area)
                        p["area_sotka"] = round(float(area) / 100, 1)
                        p["area"] = str(int(round(area)))
                        p["area_estimated"] = False
                p["photos"] = esri_photos(lat, lon)
            print(f"  OK {lat:.5f},{lon:.5f} area={area} addr={addr[:60]}")
            ok += 1
        except Exception as e:
            print("  FAIL", type(e).__name__, e)
            fail += 1
        time.sleep(args.sleep)

    if not args.dry_run:
        PLOTS.write_text(json.dumps(plots, ensure_ascii=False, indent=2), encoding="utf-8")
        print("saved", PLOTS)
    print(f"done ok={ok} fail={fail}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
