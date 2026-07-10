(() => {
  const money = (n) => {
    if (n == null || Number.isNaN(Number(n))) return "по запросу";
    return `${Math.round(Number(n)).toLocaleString("ru-RU")} ₽`;
  };

  const shortMoney = (n) => {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2).replace(/\.0$/, "")} млн ₽`;
    if (v >= 1000) return `${Math.round(v / 1000)} тыс. ₽`;
    return money(v);
  };

  const placeLabel = (p) =>
    p.place || p.settlement || p.geo_name || p.region || "Участок";

  const titleOf = (p) => {
    const area = p.area_sotka ? `${p.area_sotka} сот.` : "участок";
    return `${area} · ${placeLabel(p)}`;
  };

  let plots = [];
  let map;
  let markers = new Map();
  let activeId = null;

  const els = {
    region: document.getElementById("filter-region"),
    sort: document.getElementById("filter-sort"),
    sideList: document.getElementById("side-list"),
    catalog: document.getElementById("catalog-grid"),
    modal: document.getElementById("plot-modal"),
    photo: document.getElementById("modal-photo"),
    thumbs: document.getElementById("modal-thumbs"),
    regionLabel: document.getElementById("modal-region"),
    title: document.getElementById("modal-title"),
    price: document.getElementById("modal-price"),
    specs: document.getElementById("modal-specs"),
    desc: document.getElementById("modal-desc"),
    cta: document.getElementById("modal-cta"),
    nspd: document.getElementById("modal-nspd"),
    form: document.getElementById("lead-form"),
    formNote: document.getElementById("form-note"),
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
    const label = shortMoney(plot.cadastre_cost_num);
    return L.divIcon({
      className: "",
      html: `<div class="price-marker${active ? " active" : ""}">${label}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
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
    if (list.length) {
      const bounds = L.latLngBounds(list.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds.pad(0.18), { maxZoom: 6 });
    }
  }

  function renderSide() {
    const list = filtered();
    els.sideList.innerHTML = list
      .map((p) => {
        const img = p.photos?.[0]?.url || "";
        return `
        <article class="side-item${p.cadastre === activeId ? " active" : ""}" data-id="${p.cadastre}">
          <img src="${img}" alt="" loading="lazy" />
          <div>
            <h3>${titleOf(p)}</h3>
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
        return `
        <article class="catalog-card" data-id="${p.cadastre}">
          <img src="${img}" alt="Спутник: ${titleOf(p)}" loading="lazy" />
          <div class="body">
            <h3>${titleOf(p)}</h3>
            <div class="card-meta">${(p.region || "").trim() || "Россия"}<br>${p.cadastre}</div>
            <div class="price-tag">${money(p.cadastre_cost_num)}</div>
          </div>
        </article>`;
      })
      .join("");
  }

  function openModal(plot) {
    activeId = plot.cadastre;
    syncMarkers();
    renderSide();

    const photos = plot.photos || [];
    let idx = 0;
    const showPhoto = (i) => {
      idx = i;
      els.photo.src = photos[i]?.url || "";
      els.photo.alt = photos[i]?.caption || "Фото участка";
      [...els.thumbs.children].forEach((btn, j) => btn.classList.toggle("active", j === i));
    };

    els.thumbs.innerHTML = photos
      .map(
        (ph, i) =>
          `<button type="button" data-i="${i}" class="${i === 0 ? "active" : ""}"><img src="${ph.url}" alt="${ph.caption || ""}" /></button>`
      )
      .join("");
    els.thumbs.onclick = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (!btn) return;
      showPhoto(Number(btn.dataset.i));
    };
    showPhoto(0);

    els.regionLabel.textContent = (plot.region || plot.geo_name || "Россия").trim();
    els.title.textContent = titleOf(plot);
    els.price.textContent = money(plot.cadastre_cost_num);
    els.desc.textContent = plot.ad || "";
    els.nspd.href = plot.nspd_url || plot.pkk_url || "#";
    els.cta.onclick = () => {
      closeModal();
      const input = els.form.querySelector('[name="plot"]');
      if (input) input.value = plot.cadastre;
    };

    const perSotka =
      plot.cadastre_cost_num && plot.area_sotka
        ? money(plot.cadastre_cost_num / plot.area_sotka)
        : "—";
    els.specs.innerHTML = [
      ["Кадастровый номер", plot.cadastre],
      ["Площадь", plot.area_sotka ? `${plot.area_sotka} сот. (${plot.area_m2} м²)` : "—"],
      ["Кадастровая стоимость", money(plot.cadastre_cost_num)],
      ["Цена за сотку (кадастр)", perSotka],
      ["Статус", plot.status || "—"],
      ["Аренда в год", plot.rent_year ? money(Number(String(plot.rent_year).replace(",", "."))) : "—"],
      ["Координаты", `${plot.lat.toFixed(5)}, ${plot.lon.toFixed(5)}`],
      ["Плотность", plot.density ? `${plot.density} чел/га` : "—"],
    ]
      .map(
        ([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`
      )
      .join("");

    els.modal.hidden = false;
    document.body.style.overflow = "hidden";

    const marker = markers.get(plot.cadastre);
    if (marker) map.panTo(marker.getLatLng(), { animate: true });
  }

  function closeModal() {
    els.modal.hidden = true;
    document.body.style.overflow = "";
  }

  function refresh() {
    syncMarkers();
    renderSide();
    renderCatalog();
  }

  function initMap() {
    map = L.map("leaflet-map", {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView([58.5, 70], 3);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        opacity: 0.0,
        maxZoom: 19,
        attribution: "Esri",
      }
    );

    plots.forEach((p) => {
      const marker = L.marker([p.lat, p.lon], {
        icon: priceIcon(p),
        riseOnHover: true,
      });
      marker.on("click", () => openModal(p));
      markers.set(p.cadastre, marker);
      marker.addTo(map);
    });
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
    els.statValue.textContent = shortMoney(sum);
  }

  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-id]");
    if (card && !e.target.closest(".modal")) {
      const plot = plots.find((p) => p.cadastre === card.dataset.id);
      if (plot) openModal(plot);
    }
    if (e.target.matches("[data-close]")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  els.region.addEventListener("change", refresh);
  els.sort.addEventListener("change", refresh);

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(els.form);
    const name = data.get("name");
    const contact = data.get("contact");
    const plot = data.get("plot") || "не указан";
    const text = `Заявка ЗЕМЛЯ\nИмя: ${name}\nКонтакт: ${contact}\nУчасток: ${plot}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    els.formNote.hidden = false;
    els.formNote.textContent =
      "Заявка скопирована. Напишите её владельцу через Telegram/WhatsApp или Issues на GitHub — ответим по документам.";
    els.form.reset();
  });

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
