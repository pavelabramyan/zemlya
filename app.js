(() => {
  const money = (n) => {
    if (n == null || Number.isNaN(Number(n))) return "по запросу";
    return `${Math.round(Number(n)).toLocaleString("ru-RU")} ₽`;
  };

  const avitoMoney = (n) => {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Math.round(Number(n));
    if (v >= 1_000_000) {
      const m = v / 1_000_000;
      return `${m.toFixed(1).replace(".0", "").replace(".", ",")} млн ₽`;
    }
    return `${v.toLocaleString("ru-RU")} ₽`;
  };

  const placeLabel = (p) => {
    const candidates = [p.settlement, p.geo_name, p.place, p.region];
    for (const raw of candidates) {
      const s = String(raw || "").trim();
      if (!s) continue;
      if (/\d+:\d+/.test(s)) continue;
      if (s.includes(",")) {
        const parts = s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i -= 1) {
          if (parts[i] && !/\d+:\d+/.test(parts[i]) && parts[i].length > 2) return parts[i];
        }
      }
      return s;
    }
    return "Участок";
  };

  const titleOf = (p) => {
    const area = p.area_sotka
      ? `${String(p.area_sotka).replace(/\.0$/, "")} сот.`
      : "участок";
    return `${area} · ${placeLabel(p)}`;
  };

  let plots = [];
  let map;
  let markers = new Map();
  let activeId = null;
  let plotLayer = null;

  const els = {
    region: document.getElementById("filter-region"),
    sort: document.getElementById("filter-sort"),
    sideList: document.getElementById("side-list"),
    catalog: document.getElementById("catalog-grid"),
    card: document.getElementById("map-card"),
    cardClose: document.getElementById("map-card-close"),
    photo: document.getElementById("map-card-photo"),
    regionLabel: document.getElementById("map-card-region"),
    title: document.getElementById("map-card-title"),
    price: document.getElementById("map-card-price"),
    specs: document.getElementById("map-card-specs"),
    desc: document.getElementById("map-card-desc"),
    mapRu: document.getElementById("map-card-mapru"),
    note: document.getElementById("map-card-note"),
    statCount: document.getElementById("stat-count"),
    statRegions: document.getElementById("stat-regions"),
    statValue: document.getElementById("stat-value"),
  };

  function filtered() {
    const region = els.region.value;
    let list = plots.filter((p) => !region || (p.region || "").trim() === region);
    const sort = els.sort.value;
    return [...list].sort((a, b) => {
      if (sort === "cost-asc") return (a.cadastre_cost_num || 0) - (b.cadastre_cost_num || 0);
      if (sort === "area-desc") return (b.area_m2 || 0) - (a.area_m2 || 0);
      if (sort === "area-asc") return (a.area_m2 || 0) - (b.area_m2 || 0);
      return (b.cadastre_cost_num || 0) - (a.cadastre_cost_num || 0);
    });
  }

  function priceIcon(plot, active = false) {
    const label = avitoMoney(plot.cadastre_cost_num);
    return L.divIcon({
      className: "avito-marker-wrap",
      html: `<div class="avito-pin${active ? " is-active" : ""}"><span>${label}</span></div>`,
      iconSize: [1, 1],
      iconAnchor: [40, 28],
    });
  }

  /** Ссылка на участок на map.ru (публичная кадастровая карта). */
  function mapRuUrl(plot) {
    const kad = encodeURIComponent(String(plot.cadastre || "").trim());
    return kad ? `https://map.ru/pkk?kad=${kad}&z=17` : "https://map.ru/pkk";
  }

  /** Реальный контур по данным кадастра, иначе приближение по площади. */
  function plotPolygon(plot) {
    if (Array.isArray(plot.leaflet_ring) && plot.leaflet_ring.length >= 3) {
      return plot.leaflet_ring;
    }
    const lat = Number(plot.lat);
    const lon = Number(plot.lon);
    const area = Math.max(Number(plot.area_m2) || 1000, 400);
    const side = Math.sqrt(area);
    const dLat = side / 111320 / 2;
    const dLon = side / (111320 * Math.cos((lat * Math.PI) / 180)) / 2;
    const kx = 1.15;
    const ky = 0.9;
    return [
      [lat - dLat * ky, lon - dLon * kx],
      [lat - dLat * ky, lon + dLon * kx],
      [lat + dLat * ky, lon + dLon * kx],
      [lat + dLat * ky, lon - dLon * kx],
    ];
  }

  function clearPlotHighlight() {
    if (plotLayer) {
      map.removeLayer(plotLayer);
      plotLayer = null;
    }
  }

  function showPlotHighlight(plot) {
    clearPlotHighlight();
    const ring = plotPolygon(plot);
    plotLayer = L.polygon(ring, {
      color: "#c9a400",
      weight: 3,
      opacity: 1,
      fillColor: "#ffe566",
      fillOpacity: 0.45,
      className: "plot-highlight",
    }).addTo(map);
    return plotLayer;
  }

  function syncMarkers() {
    const list = filtered();
    const visible = new Set(list.map((p) => p.cadastre));
    markers.forEach((marker, id) => {
      const show = visible.has(id);
      if (show) {
        if (!map.hasLayer(marker)) marker.addTo(map);
        marker.setIcon(priceIcon(plots.find((p) => p.cadastre === id), id === activeId));
      } else if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    });
  }

  function fitAll() {
    const list = filtered();
    if (!list.length) return;
    const bounds = L.latLngBounds(list.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds.pad(0.18), { maxZoom: 6 });
  }

  function renderSide() {
    const list = filtered();
    els.sideList.innerHTML = list
      .map((p) => {
        const img = p.photos?.[0]?.url || "";
        const est = p.area_estimated ? '<span class="badge-est">≈ площадь</span>' : "";
        return `
        <article class="side-item${p.cadastre === activeId ? " active" : ""}" data-id="${p.cadastre}">
          <img src="${img}" alt="" loading="lazy" />
          <div>
            <h3>${titleOf(p)} ${est}</h3>
            <div class="side-meta">${(p.region || "").trim() || "Россия"} · ${p.cadastre}</div>
            <div class="price-tag">${money(p.cadastre_cost_num)}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderCatalog() {
    const list = filtered();
    els.catalog.innerHTML = list
      .map((p) => {
        const img = p.photos?.[0]?.url || "";
        const est = p.area_estimated ? '<span class="badge-est">площадь ориентировочная</span>' : "";
        return `
        <article class="catalog-card" data-id="${p.cadastre}">
          <img src="${img}" alt="Спутник: ${titleOf(p)}" loading="lazy" />
          <div class="body">
            <h3>${titleOf(p)}</h3>
            ${est}
            <div class="card-meta">${(p.region || "").trim() || "Россия"}<br>${p.cadastre}</div>
            <div class="price-tag">${money(p.cadastre_cost_num)}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  function fillMapCard(plot) {
    els.regionLabel.textContent = (plot.region || plot.geo_name || "Россия").trim();
    els.title.textContent = titleOf(plot);
    els.price.textContent = money(plot.cadastre_cost_num);
    els.desc.textContent = plot.ad || "";
    els.photo.src = plot.photos?.[0]?.url || "";
    els.photo.alt = `Спутник: ${titleOf(plot)}`;
    els.mapRu.href = mapRuUrl(plot);

    const areaText = plot.area_sotka
      ? `${String(plot.area_sotka).replace(/\.0$/, "")} сот. (${Math.round(plot.area_m2)} м²)${plot.area_estimated ? " · ориентир." : ""}`
      : "—";

    els.specs.innerHTML = [
      ["Кадастровый номер", plot.cadastre],
      ["Площадь", areaText],
      ["Кадастровая стоимость", money(plot.cadastre_cost_num)],
      ["Локация", placeLabel(plot)],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join("");

    if (els.note) {
      els.note.textContent = plot.leaflet_ring
        ? "Жёлтый контур — границы участка. Точные данные — на map.ru."
        : plot.area_estimated
          ? "Жёлтый контур и площадь — ориентировочные. Точные границы — на map.ru / в выписке ЕГРН."
          : "Жёлтый контур ориентировочный. Точные границы — на map.ru / в выписке ЕГРН.";
    }
  }

  function openPlot(plot) {
    activeId = plot.cadastre;
    syncMarkers();
    renderSide();
    fillMapCard(plot);
    els.card.hidden = false;
    document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "start" });

    const layer = showPlotHighlight(plot);
    const bounds = layer.getBounds().pad(0.55);
    map.flyToBounds(bounds, {
      duration: 0.85,
      maxZoom: 17,
    });
    map.once("moveend", () => map.invalidateSize());
    requestAnimationFrame(() => map.invalidateSize());
  }

  function closePlot() {
    activeId = null;
    els.card.hidden = true;
    clearPlotHighlight();
    syncMarkers();
    renderSide();
  }

  function refresh() {
    syncMarkers();
    renderSide();
    renderCatalog();
    if (!activeId) fitAll();
  }

  function initMap() {
    map = L.map("leaflet-map", {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    }).setView([58.5, 70], 3);

    L.tileLayer("https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}", {
      subdomains: ["0", "1", "2", "3"],
      maxZoom: 18,
      attribution: "",
    }).addTo(map);

    plots.forEach((p) => {
      const marker = L.marker([p.lat, p.lon], {
        icon: priceIcon(p),
        riseOnHover: true,
      });
      marker.on("click", () => openPlot(p));
      markers.set(p.cadastre, marker);
      marker.addTo(map);
    });

    map.on("click", (e) => {
      if (plotLayer && plotLayer.getBounds().contains(e.latlng)) return;
      if (activeId) closePlot();
    });

    window.addEventListener("resize", () => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 200);
  }

  function fillRegions() {
    const regions = [...new Set(plots.map((p) => (p.region || "").trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "ru")
    );
    regions.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      els.region.appendChild(opt);
    });
  }

  function updateStats() {
    const regions = new Set(plots.map((p) => (p.region || "").trim()).filter(Boolean));
    const sum = plots.reduce((acc, p) => acc + (p.cadastre_cost_num || 0), 0);
    els.statCount.textContent = String(plots.length);
    els.statRegions.textContent = String(regions.size);
    els.statValue.textContent = avitoMoney(sum);
  }

  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card) {
      const plot = plots.find((p) => p.cadastre === card.dataset.id);
      if (plot) openPlot(plot);
    }
  });

  els.cardClose?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePlot();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePlot();
  });

  els.region.addEventListener("change", () => {
    closePlot();
    refresh();
  });
  els.sort.addEventListener("change", refresh);

  fetch("data/plots.json")
    .then((r) => r.json())
    .then((data) => {
      plots = data.filter((p) => p.lat != null && p.lon != null);
      updateStats();
      fillRegions();
      initMap();
      refresh();
    })
    .catch((err) => {
      console.error(err);
      els.sideList.innerHTML = `<p class="side-hint">Не удалось загрузить участки.</p>`;
    });
})();
