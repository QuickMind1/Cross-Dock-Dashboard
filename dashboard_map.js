import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA-hCb_di_Xi4QiNmIns1mdVp0KQGe3eGc",
  authDomain: "crossdock-bce69.firebaseapp.com",
  projectId: "crossdock-bce69",
  storageBucket: "crossdock-bce69.firebasestorage.app",
  messagingSenderId: "2268808257",
  appId: "1:2268808257:web:2db3e6aad59e2d67c5f2c0",
  measurementId: "G-9R77W6DE9W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let allTrips = []; 
let geoChart;
let mapData;
let currentMapMode = 'origen';
let mapContainerListenerAttached = false;
let currentFilteredTrips = [];
let currentFilterName = "";
let currentDetailFilter = null;
let currentPage = 1;
const PAGE_SIZE = 10;
let searchQuery = "";
let sortOrder = "newest";

const TripState = {
    GATHERING_DRIVERS: 'gatheringDrivers',
    COORDINATED: 'coordinated',
    IN_TRANSIT: 'inTransit',
    DELAYED: 'delayed',
    COMPLETED: 'completed',
    CANCELED: 'canceled',
};

const STATE_LABELS = {
    [TripState.GATHERING_DRIVERS]: 'BUSCANDO',
    [TripState.COORDINATED]:       'COORDINADO',
    [TripState.IN_TRANSIT]:        'EN TRÁNSITO',
    [TripState.DELAYED]:           'ATRASADO',
    [TripState.COMPLETED]:         'COMPLETADO',
    [TripState.CANCELED]:          'CANCELADO',
};

const STATE_BADGES = {
    [TripState.GATHERING_DRIVERS]: 'bg-amber-100 text-amber-800',
    [TripState.COORDINATED]:       'bg-sky-100 text-sky-800',
    [TripState.IN_TRANSIT]:        'bg-blue-100 text-blue-800',
    [TripState.DELAYED]:           'bg-red-100 text-red-800',
    [TripState.COMPLETED]:         'bg-emerald-100 text-emerald-800',
    [TripState.CANCELED]:          'bg-slate-200 text-slate-700',
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-label').textContent = user.email;
        google.charts.load('current', {
            'packages':['geochart'],
        });
        google.charts.setOnLoadCallback(fetchTrips);
    } else {
        window.location.href = "index.html"; 
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {})
        .catch((error) => {
            console.error("Logout error: ", error);
        });
});

document.getElementById('trip-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    currentPage = 1;
    renderTripList();
});

document.getElementById('trip-sort').addEventListener('change', (e) => {
    sortOrder = e.target.value;
    currentPage = 1;
    renderTripList();
});

document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderTripList();
    }
});

document.getElementById('btn-next').addEventListener('click', () => {
    currentPage++;
    renderTripList();
});

async function fetchTrips() {
    try {
        const response = await fetch('https://crossdock-api-2268808257.us-east1.run.app/api/trips');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const trips = await response.json();

        allTrips = trips;
        let coordinated = 0, gatheringDrivers = 0, delayed = 0, completed = 0, inTransit = 0, canceled = 0;

        allTrips.forEach((trip) => {
            switch (trip.estado) {
                case TripState.COORDINATED:       coordinated++;      break;
                case TripState.GATHERING_DRIVERS: gatheringDrivers++; break;
                case TripState.DELAYED:           delayed++;          break;
                case TripState.COMPLETED:         completed++;        break;
                case TripState.IN_TRANSIT:        inTransit++;        break;
                case TripState.CANCELED:          canceled++;         break;
            }
        });

        document.getElementById('val-total-trips').innerText = allTrips.length;

        /*Los viajes que han sido coordinados (ya tienen todos los transportistas asginados) 
        y los que ya fueron coordinados pero estan en servicio (en tránsito) y antes de la fecha 
        de llegada estimada, son considerados a tiempo. */
        document.getElementById('val-ontime').innerText = inTransit + coordinated; 

        document.getElementById('val-delayed').innerText = delayed;
        document.getElementById('val-incidence').innerText = gatheringDrivers;
        document.getElementById('val-pendent').innerText = completed;

        processDataAndDrawMap();

        const detailView = document.getElementById('detail-view');
        if (detailView && !detailView.classList.contains('hidden') && currentDetailFilter) {
            window.showDetails(currentDetailFilter.type, currentDetailFilter.value);
        }
    } catch (error) {
        console.error("Error fetching trips: ", error);
    }
}

window.refreshTrips = fetchTrips;

function processDataAndDrawMap() {
    let stateCounts = {};

    allTrips.forEach((trip) => {
        const stateCode = currentMapMode === 'origen'
            ? (trip.origen_iso || mapOriginToStateCode(trip.origen))
            : (trip.destino_iso || mapOriginToStateCode(trip.destino));
        if (stateCode) {
            stateCounts[stateCode] = (stateCounts[stateCode] || 0) + 1;
        }
    });

    drawMap(stateCounts);
}

// Exposed for dashboard.html's debounced resize handler so the GeoChart
// re-fits its container after a window resize / device rotation.
window.redrawMap = processDataAndDrawMap;

// Google GeoChart's Mexico province map still uses the pre-2016 ISO codes,
// so Mexico City must be sent as MX-DIF (Distrito Federal) even though the
// API returns the current MX-CMX (Ciudad de México). Any code not listed
// here is passed through unchanged.
const GEO_CODE_ALIASES = { 'MX-CMX': 'MX-DIF' };
const GEO_CODE_ALIASES_REVERSE = Object.fromEntries(
    Object.entries(GEO_CODE_ALIASES).map(([appCode, geoCode]) => [geoCode, appCode])
);

// App ISO code -> code that GeoChart understands.
function toGeoChartCode(stateCode) {
    return GEO_CODE_ALIASES[stateCode] || stateCode;
}

// GeoChart code (from a map selection) -> app ISO code used across the data.
function fromGeoChartCode(geoCode) {
    return GEO_CODE_ALIASES_REVERSE[geoCode] || geoCode;
}

function drawMap(stateCounts) {
    mapData = new google.visualization.DataTable();
    mapData.addColumn('string', 'Estado');
    mapData.addColumn('number', 'Viajes Activos');

    for (const [stateCode, count] of Object.entries(stateCounts)) {
        mapData.addRow([toGeoChartCode(stateCode), count]);
    }

    const options = {
        region: 'MX',
        resolution: 'provinces',
        colorAxis: {
            // Pin the low end to 0 so that when only a single state has data
            // (min === max), GeoChart still has a valid range to interpolate
            // over and colors the region at the strong end of the gradient
            // instead of leaving it blank.
            minValue: 0,
            colors: currentMapMode === 'origen' 
                ? ['#FFD5DE', '#FF6B8A', '#E52E4F']
                : ['#c1c1ee', '#6565b1', '#1A1A2E']
        },
        backgroundColor: '#f4f7f6',
        datalessRegionColor: '#eaeaea',
        defaultColor: '#f5f5f5',
    };

    const mapContainer = document.getElementById('map_div');

    if (geoChart) {
        geoChart.clearChart();
    }

    geoChart = new google.visualization.GeoChart(mapContainer);

    google.visualization.events.addListener(geoChart, 'select', () => {
        const selection = geoChart.getSelection();
        if (selection.length > 0) {
            const stateCode = fromGeoChartCode(mapData.getValue(selection[0].row, 0));
            window.showDetails('state', stateCode);
        }
    });

    // Attach the cursor handler only once; drawMap can run many times.
    if (!mapContainerListenerAttached) {
        mapContainer.addEventListener('mouseover', function(e) {
            if (e.target.tagName === 'path') {
                const fill = e.target.getAttribute('fill');

                if (fill && (fill.toLowerCase() === '#eaeaea' || fill.toLowerCase() === '#f5f5f5')) {
                    e.target.style.cursor = 'default';
                } else {
                    e.target.style.cursor = 'pointer';
                }
            }
        });
        mapContainerListenerAttached = true;
    }

    geoChart.draw(mapData, options);
}

window.toggleMapMode = function(mode) {
    if (currentMapMode === mode) return;

    currentMapMode = mode;

    const btnOrigin = document.getElementById('btnOrigin');
    const btnDestination = document.getElementById('btnDestination');

    if (mode === 'origen') {
        btnOrigin.className = "px-4 py-1.5 text-sm font-bold rounded-md bg-white shadow-sm text-slate-800 transition-all";
        btnDestination.className = "px-4 py-1.5 text-sm font-medium rounded-md text-slate-500 hover:text-slate-800 transition-all";
    } else {
        btnDestination.className = "px-4 py-1.5 text-sm font-bold rounded-md bg-white shadow-sm text-slate-800 transition-all";
        btnOrigin.className = "px-4 py-1.5 text-sm font-medium rounded-md text-slate-500 hover:text-slate-800 transition-all";
    }

    processDataAndDrawMap();
}

window.showDetails = function(filterType, filterValue) {
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('detail-view').classList.remove('hidden');

    currentDetailFilter = { type: filterType, value: filterValue };

    if (filterType === 'status') {
        if (filterValue === 'incidencias') {
            document.getElementById('table-title').innerText = 'Viajes filtrados que presentan al menos una incidencia';
            currentFilteredTrips = allTrips.filter(t => {
                const missingDriver = !t.transportista || (typeof t.transportista === 'string' && t.transportista.trim() === '');
                const unconfirmed = t.estado === TripState.GATHERING_DRIVERS;

                return missingDriver || unconfirmed;

                // Change later to complete and get another data for check the tranportistas needed
            });
        } else {
            document.getElementById('table-title').innerText = `Viajes filtrados por estado: ${filterValue.toUpperCase()}`;
            currentFilteredTrips = allTrips.filter(t => t.estado === filterValue);
        }
        currentFilterName = filterValue;
    } 
    else if (filterType === 'state') {
        const modeText = currentMapMode === 'origen' ? 'Origen' : 'Destino';
        document.getElementById('table-title').innerText = `Viajes con ${modeText} en ${filterValue.replace('MX-', '')}`;
        currentFilterName = filterValue.replace('MX-', '');
        currentFilteredTrips = allTrips.filter(t => { 
            const stateCode = currentMapMode === 'origen'
                ? (t.origen_iso || mapOriginToStateCode(t.origen))
                : (t.destino_iso || mapOriginToStateCode(t.destino));
            return stateCode === filterValue;
        });
    } else {
        document.getElementById('table-title').innerText = 'Mostrando todos los viajes';
        currentFilteredTrips = allTrips;
        currentFilterName = "all_trips";
    }

    currentPage = 1;
    renderTripList();
};

function renderTripList() {
    const tableBody = document.getElementById('detail-table-body');
    const cardList = document.getElementById('detail-card-list');
    tableBody.innerHTML = '';
    if (cardList) cardList.innerHTML = '';

    const info = document.getElementById('pagination-info');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    let trips = currentFilteredTrips;

    const query = searchQuery.trim().toLowerCase();
    if (query) {
        trips = trips.filter(t =>
            String(t.origen || '').toLowerCase().includes(query) ||
            String(t.destino || '').toLowerCase().includes(query)
        );
    }

    trips = trips.slice().sort((a, b) => {
        const ta = a.fecha_mensaje ? new Date(a.fecha_mensaje).getTime() : NaN;
        const tb = b.fecha_mensaje ? new Date(b.fecha_mensaje).getTime() : NaN;
        const va = isNaN(ta) ? 0 : ta;
        const vb = isNaN(tb) ? 0 : tb;
        return sortOrder === 'newest' ? vb - va : va - vb;
    });

    const total = trips.length;

    if (total === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-8 text-center text-sm text-slate-500 italic">
                    No hay viajes que coincidan con este filtro.
                </td>
            </tr>
        `;
        if (cardList) {
            cardList.innerHTML = `
                <div class="rounded-lg border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-slate-500 italic">
                    No hay viajes que coincidan con este filtro.
                </div>
            `;
        }
        if (info) info.textContent = '0 viajes';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageTrips = trips.slice(startIdx, startIdx + PAGE_SIZE);

    pageTrips.forEach((trip, index) => {
        const badgeStyle = STATE_BADGES[trip.estado] || "bg-slate-100 text-slate-800";
        const stateLabel = STATE_LABELS[trip.estado] || trip.estado || 'N/A';

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors cursor-pointer";
        row.dataset.tripIndex = index;
        row.innerHTML = `
            <td class="px-4 py-4 w-8 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="expand-chevron transition-transform duration-200">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${badgeStyle}">
                    ${stateLabel}
                </span>
            </td>
            <td class="px-6 py-4 font-medium text-slate-800">${trip.origen || 'N/A'}</td>
            <td class="px-6 py-4 text-slate-600">${trip.destino || 'N/A'}</td>
            <td class="px-6 py-4 text-slate-600">${
                trip.fecha_salida 
                    ? new Date(trip.fecha_salida).toLocaleString('es-MX', { 
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', 
                        timeZone: 'America/Mexico_City' 
                    })
                    : 'N/A'
                }
            </td>
            <td class="px-6 py-4 text-slate-600">${trip.tipo_carga || 'N/A'}</td>
            <td class="px-6 py-4 text-slate-600">${trip.cantidadActualDeTransportistas ?? 0}/${trip.cantidadTransportistas ?? 0}</td>
        `;

        const detailsRow = document.createElement('tr');
        detailsRow.className = "trip-details-row hidden bg-slate-50/70";
        detailsRow.innerHTML = `
            <td colspan="7" class="px-6 py-5 border-l-4 border-icon">
                ${buildTripDetails(trip)}
            </td>
        `;

        row.addEventListener('click', () => {
            const isHidden = detailsRow.classList.contains('hidden');
            detailsRow.classList.toggle('hidden');
            const chevron = row.querySelector('.expand-chevron');
            if (chevron) {
                chevron.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
            row.classList.toggle('bg-slate-50', isHidden);
        });

        tableBody.appendChild(row);
        tableBody.appendChild(detailsRow);

        if (cardList) {
            const salidaText = trip.fecha_salida
                ? new Date(trip.fecha_salida).toLocaleString('es-MX', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    timeZone: 'America/Mexico_City'
                })
                : 'N/A';

            const card = document.createElement('div');
            card.className = 'rounded-lg border border-border bg-surface shadow-sm overflow-hidden';
            card.innerHTML = `
                <button type="button"
                        class="w-full text-left p-4 active:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-icon"
                        aria-expanded="false">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <span class="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${badgeStyle}">
                            ${stateLabel}
                        </span>
                        <span class="text-xs text-slate-400 whitespace-nowrap">${salidaText}</span>
                    </div>
                    <div class="flex items-center gap-2 min-w-0">
                        <div class="flex-1 min-w-0">
                            <p class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Origen</p>
                            <p class="font-bold text-text text-sm leading-snug break-words">${trip.origen || 'N/A'}</p>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-300 flex-shrink-0">
                            <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                        </svg>
                        <div class="flex-1 min-w-0 text-right">
                            <p class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Destino</p>
                            <p class="font-bold text-text text-sm leading-snug break-words">${trip.destino || 'N/A'}</p>
                        </div>
                    </div>
                </button>
                <div class="mobile-card-body hidden border-t border-border bg-slate-50 p-4">
                    ${buildTripDetails(trip)}
                </div>
            `;

            const btn = card.querySelector('button');
            const body = card.querySelector('.mobile-card-body');
            btn.addEventListener('click', () => {
                const willOpen = body.classList.contains('hidden');
                body.classList.toggle('hidden');
                btn.setAttribute('aria-expanded', String(willOpen));
            });

            cardList.appendChild(card);
        }
    });

    if (info) info.textContent = `${startIdx + 1}-${startIdx + pageTrips.length} de ${total}`;
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function buildTripDetails(trip) {
    const usedKeys = new Set([
        'estado', 'origen', 'destino', 'fecha_salida',
        'tipo_carga', 'cantidadActualDeTransportistas', 'cantidadTransportistas',
        'transportistas', 'historial'
    ]);

    const prettyLabel = (key) => key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

    const formatValue = (key, value) => {
        if (value === null || value === undefined || value === '') return '<span class="text-slate-400 italic">N/A</span>';

        if (Array.isArray(value)) {
            if (value.length === 0) return '<span class="text-slate-400 italic">Vacío</span>';
            return `<ul class="list-disc list-inside space-y-1">${
                value.map(v => `<li>${typeof v === 'object' ? escapeHtml(JSON.stringify(v)) : escapeHtml(String(v))}</li>`).join('')
            }</ul>`;
        }

        if (typeof value === 'object') {
            if (value.seconds !== undefined && value.nanoseconds !== undefined) {
                const date = new Date(value.seconds * 1000);
                return escapeHtml(date.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }));
            }
            return `<pre class="text-xs bg-white p-2 rounded border border-border overflow-x-auto">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
        }

        if (/fecha/i.test(key) && !isNaN(new Date(value).getTime())) {
            return escapeHtml(new Date(value).toLocaleString('es-MX', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
                timeZone: 'America/Mexico_City'
            }));
        }

        return escapeHtml(String(value));
    };

    const extraEntries = Object.entries(trip).filter(([k]) => !usedKeys.has(k));

    const cards = extraEntries.map(([key, value]) => `
        <div class="bg-white rounded-lg p-4 border border-border shadow-sm">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${escapeHtml(prettyLabel(key))}</div>
            <div class="text-sm text-slate-800 break-words">${formatValue(key, value)}</div>
        </div>
    `).join('');

    const detailsSection = extraEntries.length === 0
        ? ''
        : `
            <h4 class="text-sm font-bold text-primary mt-5 mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 16v-4"></path>
                    <path d="M12 8h.01"></path>
                </svg>
                Detalles del viaje
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${cards}
            </div>
        `;

    return `
        <div>
            ${buildStatusBar(trip)}
            ${buildStatusNotice(trip)}
            ${buildDriversList(trip)}
            ${detailsSection}
        </div>
    `;
}

function buildDriversList(trip) {
    const drivers = Array.isArray(trip.transportistas) ? trip.transportistas : [];
    const needed = trip.cantidadTransportistas ?? 0;
    const current = drivers.length;

    const isComplete = needed > 0 && current >= needed;
    const counterStyle = isComplete
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';

    const header = `
        <h4 class="text-sm font-bold text-primary mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            Transportistas asignados
            <span class="ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${counterStyle}">${current}/${needed}</span>
        </h4>
    `;

    if (drivers.length === 0) {
        return `
            <div class="mb-2">
                ${header}
                <div class="rounded-lg border border-dashed border-border bg-white p-4 text-center text-sm text-slate-500 italic">
                    Aún no hay transportistas asignados a este viaje.
                </div>
            </div>
        `;
    }

    const palette = [
        'bg-icon', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
        'bg-purple-500', 'bg-sky-500', 'bg-rose-500', 'bg-teal-500'
    ];

    const items = drivers.map((d, i) => {
        const nickname = (d && d.nickname) ? String(d.nickname) : 'Sin nombre';
        const initial = nickname.trim().charAt(0).toUpperCase() || '?';
        const color = palette[i % palette.length];
        const message = (d && d.driver_confirmation_message) ? String(d.driver_confirmation_message) : '';

        const messageHtml = message
            ? `<p class="text-xs text-slate-500 mt-0.5 break-words">${escapeHtml(message)}</p>`
            : '';

        return `
            <li class="flex items-start gap-3 p-3 bg-white rounded-lg border border-border shadow-sm">
                <span class="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full ${color} text-white text-sm font-bold uppercase">
                    ${escapeHtml(initial)}
                </span>
                <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(nickname)}</p>
                    ${messageHtml}
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 mt-1 text-emerald-500">
                    <path d="M20 6 9 17l-5-5"></path>
                </svg>
            </li>
        `;
    }).join('');

    return `
        <div class="mb-2">
            ${header}
            <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${items}
            </ul>
        </div>
    `;
}

function buildStatusBar(trip) {
    const STEPS = [
        { key: TripState.GATHERING_DRIVERS, label: 'Buscando' },
        { key: TripState.COORDINATED,       label: 'Coordinado' },
        { key: TripState.IN_TRANSIT,        label: 'En Tránsito' },
        { key: TripState.COMPLETED,         label: 'Completado' },
    ];
    const STEP_INDEX = {
        [TripState.GATHERING_DRIVERS]: 0,
        [TripState.COORDINATED]:       1,
        [TripState.IN_TRANSIT]:        2,
        [TripState.COMPLETED]:         3,
    };

    // Prefer the recorded history; fall back to the trip's current state.
    const history = (Array.isArray(trip.historial) && trip.historial.length)
        ? trip.historial
        : (trip.estado ? [{ status_type: trip.estado }] : []);

    if (history.length === 0) return '';

    const latest = history[history.length - 1].status_type;
    const isCanceled = latest === TripState.CANCELED;
    const isDelayed = latest === TripState.DELAYED;

    // Furthest core step reached (delayed sits on the "En Tránsito" step).
    let currentIndex = -1;
    history.forEach((h) => {
        let idx = STEP_INDEX[h.status_type];
        if (idx === undefined && h.status_type === TripState.DELAYED) idx = STEP_INDEX[TripState.IN_TRANSIT];
        if (idx !== undefined && idx > currentIndex) currentIndex = idx;
    });
    if (currentIndex < 0) currentIndex = 0;

    const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;
    const alertIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

    const nodes = STEPS.map((step, i) => {
        const reached = i <= currentIndex;
        const current = i === currentIndex;

        let circle;
        let labelCls;
        if (reached) {
            const bg = (current && isDelayed) ? 'bg-red-500' : 'bg-icon';
            circle = `<div class="w-8 h-8 rounded-full ${bg} flex items-center justify-center text-white shadow-sm">${(current && isDelayed) ? alertIcon : checkIcon}</div>`;
            labelCls = current
                ? ((isDelayed ? 'text-red-600' : 'text-text') + ' font-bold')
                : 'text-text';
        } else {
            circle = `<div class="w-8 h-8 rounded-full border-2 border-slate-300 bg-white"></div>`;
            labelCls = 'text-slate-400';
        }

        const connector = i === 0
            ? ''
            : `<div class="flex-1 h-1 mt-[14px] rounded-full ${reached ? (isDelayed ? 'bg-red-400' : 'bg-icon') : 'bg-slate-200'}"></div>`;

        return `
            ${connector}
            <div class="flex flex-col items-center flex-shrink-0 w-16 sm:w-20">
                ${circle}
                <span class="mt-2 text-[11px] sm:text-xs text-center leading-tight ${labelCls}">${step.label}</span>
            </div>
        `;
    }).join('');

    let titleLabel;
    let titleCls;
    if (isCanceled) {
        titleLabel = 'Cancelado';
        titleCls = 'text-slate-600';
    } else if (isDelayed) {
        titleLabel = 'Atrasado';
        titleCls = 'text-red-600';
    } else {
        titleLabel = STEPS[currentIndex].label;
        titleCls = 'text-text';
    }

    const canceledBanner = isCanceled
        ? `<div class="mt-4 flex items-center gap-2 text-sm text-slate-600 bg-slate-100 border border-slate-300 rounded-lg px-3 py-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 text-slate-500"><circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path></svg>
                Este viaje fue cancelado.
           </div>`
        : '';

    return `
        <div class="mb-5 rounded-lg border border-border bg-white p-4 sm:p-5">
            <h3 class="text-lg sm:text-xl font-bold mb-4 ${titleCls}">${titleLabel}</h3>
            <div class="flex items-start justify-between gap-1 px-1">
                ${nodes}
            </div>
            ${canceledBanner}
        </div>
    `;
}

function buildStatusNotice(trip) {
    const notices = {
        [TripState.GATHERING_DRIVERS]: {
            style: 'bg-amber-50 border-amber-300 text-amber-800',
            iconColor: 'text-amber-500',
            title: 'Búsqueda de transportistas en curso',
            message: 'Este viaje aún no cuenta con todos los transportistas solicitados. Se sigue buscando cobertura para completar la asignación.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path>'
        },
        [TripState.COORDINATED]: {
            style: 'bg-sky-50 border-sky-300 text-sky-800',
            iconColor: 'text-sky-500',
            title: 'Viaje coordinado',
            message: 'Este viaje ya está coordinado. La fecha de salida se encuentra programada para una fecha futura y todos los transportistas están asignados.',
            icon: '<path d="M20 6 9 17l-5-5"></path>'
        },
        [TripState.IN_TRANSIT]: {
            style: 'bg-blue-50 border-blue-300 text-blue-800',
            iconColor: 'text-blue-500',
            title: 'Viaje en tránsito',
            message: 'Este viaje se encuentra en servicio y avanza dentro del tiempo estimado hacia su destino.',
            icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
        },
        [TripState.DELAYED]: {
            style: 'bg-red-50 border-red-300 text-red-800',
            iconColor: 'text-red-500',
            title: 'Viaje con atraso',
            message: 'Este viaje no ha sido completado y ya superó la fecha de llegada estimada (7 días por defecto). Se recomienda revisar el estatus con el transportista.',
            icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>'
        },
        [TripState.COMPLETED]: {
            style: 'bg-emerald-50 border-emerald-300 text-emerald-800',
            iconColor: 'text-emerald-500',
            title: 'Viaje completado',
            message: 'Este viaje se ha completado con éxito. La carga fue entregada dentro del periodo establecido.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>'
        },
        [TripState.CANCELED]: {
            style: 'bg-slate-100 border-slate-300 text-slate-700',
            iconColor: 'text-slate-500',
            title: 'Viaje cancelado',
            message: 'Este viaje fue cancelado y ya no se encuentra activo.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>'
        }
    };

    const notice = notices[trip.estado];
    if (!notice) return '';

    return `
        <div class="flex items-start gap-3 p-3 mb-4 border rounded-lg ${notice.style}">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 mt-0.5 ${notice.iconColor}">
                ${notice.icon}
            </svg>
            <div class="text-sm leading-snug">
                <div class="font-semibold">${notice.title}</div>
                <div class="opacity-90">${notice.message}</div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.exportToCSV = function() {
    const query = searchQuery.trim().toLowerCase();
    const exportTrips = query
        ? currentFilteredTrips.filter(t =>
            String(t.origen || '').toLowerCase().includes(query) ||
            String(t.destino || '').toLowerCase().includes(query)
        )
        : currentFilteredTrips;

    if (exportTrips.length === 0) {
        alert("No hay datos para exportar");
        return;
    }

    const headers = ["Estado", "Origen", "Destino", "Fecha Salida", "Tipo Carga", "Transportista"];
    const csvRows = [headers.join(",")];

    exportTrips.forEach(trip => {
        const row = [
            `"${trip.estado || ''}"`,
            `"${trip.origen || ''}"`,
            `"${trip.destino || ''}"`,
            `"${trip.fecha_salida || ''}"`,
            `"${trip.tipo_carga || 'N/A'}"`,
            `"${trip.transportista || 'Sin asignar'}"`
        ];
        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");

    const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });

    const now = new Date();
    const dateStr = now.toISOString().replace(/T/, '_').replace(/:g/, '-').split('.')[0];
    const fileName = `trips_${dateStr}_${currentFilterName}.csv`;

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.goBackToMap = function() {
    document.getElementById('detail-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');

    currentDetailFilter = null;

    processDataAndDrawMap();
};

// Deprecated: move the map logic using the geocode_api script
// at the time a new trip is detected
// TODO: retrieve the state code from the trip database record
// to display it on the Geochart div
function mapOriginToStateCode(origenString) {
    if (!origenString) return null;
    const str = origenString.toLowerCase();
    
    if (str.includes("monterrey") || str.includes("nuevo león") || str.includes("nle")) return 'MX-NLE';
            if (str.includes("cdmx") || str.includes("vallejo") || str.includes("ciudad de méxico")) return 'MX-CMX';
            if (str.includes("guadalajara") || str.includes("jalisco")) return 'MX-JAL';
            if (str.includes("toluca") || str.includes("edomex") || str.includes("cuautitlán") || str.includes("tlalnepantla")) return 'MX-MEX';
            if (str.includes("mérida") || str.includes("yucatán")) return 'MX-YUC';
            if (str.includes("cancún") || str.includes("qroo") || str.includes("quintana roo")) return 'MX-ROO';
            if (str.includes("manzanillo") || str.includes("colima")) return 'MX-COL';
            if (str.includes("tijuana") || str.includes("baja california") || str.includes("bc")) return 'MX-BCN';
            if (str.includes("puebla")) return 'MX-PUE';
            if (str.includes("veracruz") || str.includes("xalapa")) return 'MX-VER';
            if (str.includes("aguascalientes")) return 'MX-AGU';
            if (str.includes("uruapan") || str.includes("michoacán")) return 'MX-MIC';
            if (str.includes("san luis") || str.includes("slp")) return 'MX-SLP';
            if (str.includes("saltillo") || str.includes("coahuila")) return 'MX-COA';
            if (str.includes("querétaro") || str.includes("qro")) return 'MX-QUE';
            if (str.includes("silao") || str.includes("guanajuato") || str.includes("león")) return 'MX-GUA';
            if (str.includes("chihuahua") || str.includes("juárez")) return 'MX-CHH';
            if (str.includes("hermosillo") || str.includes("sonora")) return 'MX-SON';
            if (str.includes("tamaulipas") || str.includes("laredo")) return 'MX-TAM';
            if (str.includes("oaxaca")) return 'MX-OAX';
            if (str.includes("chiapas")) return 'MX-CHP';
            if (str.includes("villahermosa") || str.includes("tabasco")) return 'MX-TAB';
    
    return null;
}