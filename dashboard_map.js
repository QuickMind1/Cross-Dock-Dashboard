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

// tripManager's Gin API (internal/api). Update this once it's deployed —
// see tripManager/deploy/README.md. Port 8080 is taken locally by
// Listener_WhatsAppBot's Express server, so tripManager's API defaults to
// 8081 (see tripManager/.env's PORT) — keep these in sync.
const API_BASE_URL = 'http://localhost:8081';

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
let groupFilter = "";

// Mirrors the 5 states in initTenant.sql's trip.states JSONB
// (requested -> creation -> confirmation -> dispatched -> completion).
// "requested" only applies to trips that originated from an ambiguous
// client-group order; trips created directly skip straight to "creation".
const TripState = {
    REQUESTED: 'requested',
    CREATION: 'creation',
    CONFIRMATION: 'confirmation',
    DISPATCHED: 'dispatched',
    COMPLETION: 'completion',
};

const STATUS_STEPS = [
    { key: TripState.REQUESTED,    label: 'Solicitado' },
    { key: TripState.CREATION,     label: 'Creado' },
    { key: TripState.CONFIRMATION, label: 'Confirmado' },
    { key: TripState.DISPATCHED,   label: 'En Tránsito' },
    { key: TripState.COMPLETION,   label: 'Completado' },
];

const STATE_LABELS = {
    [TripState.REQUESTED]:    'SOLICITADO',
    [TripState.CREATION]:     'CREADO',
    [TripState.CONFIRMATION]: 'CONFIRMADO',
    [TripState.DISPATCHED]:   'EN TRÁNSITO',
    [TripState.COMPLETION]:   'COMPLETADO',
};

const STATE_BADGES = {
    [TripState.REQUESTED]:    'bg-orange-100 text-orange-800',
    [TripState.CREATION]:     'bg-slate-100 text-slate-700',
    [TripState.CONFIRMATION]: 'bg-sky-100 text-sky-800',
    [TripState.DISPATCHED]:   'bg-blue-100 text-blue-800',
    [TripState.COMPLETION]:   'bg-emerald-100 text-emerald-800',
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

document.getElementById('trip-group').addEventListener('change', (e) => {
    groupFilter = e.target.value;
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
        const user = auth.currentUser;
        if (!user) return;
        const idToken = await user.getIdToken();

        const response = await fetch(`${API_BASE_URL}/api/trips`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const trips = await response.json();

        allTrips = trips;
        populateGroupFilter();

        let requested = 0, creation = 0, confirmation = 0, dispatched = 0, completion = 0;

        allTrips.forEach((trip) => {
            switch (trip.estado) {
                case TripState.REQUESTED:    requested++;    break;
                case TripState.CREATION:     creation++;     break;
                case TripState.CONFIRMATION: confirmation++; break;
                case TripState.DISPATCHED:   dispatched++;   break;
                case TripState.COMPLETION:   completion++;   break;
            }
        });

        document.getElementById('val-total-trips').innerText = allTrips.length;
        document.getElementById('val-requested').innerText = requested;
        document.getElementById('val-creation').innerText = creation;
        document.getElementById('val-confirmation').innerText = confirmation;
        document.getElementById('val-dispatched').innerText = dispatched;
        document.getElementById('val-completion').innerText = completion;

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

// Fills the company dropdown with the distinct company names present in the
// current trip data. Keeps the user's current selection when possible so a
// refresh doesn't silently reset the active filter.
function populateGroupFilter() {
    const select = document.getElementById('trip-group');
    if (!select) return;

    const companies = Array.from(
        new Set(
            allTrips
                .map(t => t.empresa)
                .filter(c => c !== null && c !== undefined && String(c).trim() !== '')
                .map(c => String(c))
        )
    ).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    // If the previously selected company is gone, fall back to "all companies".
    if (groupFilter && !companies.includes(groupFilter)) {
        groupFilter = "";
    }

    select.innerHTML = '<option value="">Todas las empresas</option>' +
        companies.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    select.value = groupFilter;
}

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
        document.getElementById('table-title').innerText = `Viajes filtrados por estado: ${STATE_LABELS[filterValue] || filterValue}`;
        currentFilteredTrips = allTrips.filter(t => t.estado === filterValue);
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

    if (groupFilter) {
        trips = trips.filter(t => String(t.empresa || '') === groupFilter);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
        trips = trips.filter(t =>
            String(t.origen || '').toLowerCase().includes(query) ||
            String(t.destino || '').toLowerCase().includes(query)
        );
    }

    trips = trips.slice().sort((a, b) => {
        const ta = a.fecha_creacion ? new Date(a.fecha_creacion).getTime() : NaN;
        const tb = b.fecha_creacion ? new Date(b.fecha_creacion).getTime() : NaN;
        const va = isNaN(ta) ? 0 : ta;
        const vb = isNaN(tb) ? 0 : tb;
        return sortOrder === 'newest' ? vb - va : va - vb;
    });

    const total = trips.length;
    const COLSPAN = 7; // chevron + estado + empresa + origen + destino + fecha + transportista

    if (total === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="${COLSPAN}" class="px-6 py-8 text-center text-sm text-slate-500 italic">
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
        const fechaText = trip.fecha_creacion
            ? new Date(trip.fecha_creacion).toLocaleString('es-MX', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                timeZone: 'America/Mexico_City'
            })
            : 'N/A';

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
            <td class="px-6 py-4 text-slate-600">${trip.empresa || 'N/A'}</td>
            <td class="px-6 py-4 font-medium text-slate-800">${trip.origen || 'N/A'}</td>
            <td class="px-6 py-4 text-slate-600">${trip.destino || 'N/A'}</td>
            <td class="px-6 py-4 text-slate-600">${fechaText}</td>
            <td class="px-6 py-4 text-slate-600">${trip.transportista || 'Sin asignar'}</td>
        `;

        const detailsRow = document.createElement('tr');
        detailsRow.className = "trip-details-row hidden bg-slate-50/70";
        detailsRow.innerHTML = `
            <td colspan="${COLSPAN}" class="px-6 py-5 border-l-4 border-icon">
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
                        <span class="text-xs text-slate-400 whitespace-nowrap">${fechaText}</span>
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

// Formats an estados.<state> ISO timestamp for display, or null if absent/invalid.
function formatStateDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Mexico_City'
    });
}

// Amazon-style step tracker: Creado -> Confirmado -> En Tránsito -> Completado.
// States are backfilled contiguously server-side (trip.GetMissingStates), so
// every step up to the furthest non-null one is guaranteed to have a date.
// Hovering a reached step shows its date; unreached steps are grayed out and
// show "Aún no alcanzado" instead.
function buildStatusBar(trip) {
    const estados = trip.estados || {};

    let currentIndex = 0;
    STATUS_STEPS.forEach((step, i) => {
        if (estados[step.key]) currentIndex = i;
    });

    const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`;

    const nodes = STATUS_STEPS.map((step, i) => {
        const reached = i <= currentIndex;
        const dateLabel = formatStateDate(estados[step.key]);
        const tooltipText = reached && dateLabel ? `${step.label}: ${dateLabel}` : 'Aún no alcanzado';

        const circle = reached
            ? `<div class="w-8 h-8 rounded-full bg-icon flex items-center justify-center text-white shadow-sm">${checkIcon}</div>`
            : `<div class="w-8 h-8 rounded-full border-2 border-slate-300 bg-white"></div>`;

        const labelCls = reached ? 'text-text' + (i === currentIndex ? ' font-bold' : '') : 'text-slate-400';
        const connector = i === 0
            ? ''
            : `<div class="flex-1 h-1 mt-[14px] rounded-full ${i <= currentIndex ? 'bg-icon' : 'bg-slate-200'}"></div>`;

        // Custom tooltip instead of the native `title` attribute: shows
        // instantly on hover (no ~1s OS delay) and is actually visible,
        // rather than a small native tooltip easy to miss.
        return `
            ${connector}
            <div class="relative group flex flex-col items-center flex-shrink-0 w-16 sm:w-20 cursor-default" aria-label="${escapeHtml(tooltipText)}">
                ${circle}
                <span class="mt-2 text-[11px] sm:text-xs text-center leading-tight ${labelCls}">${step.label}</span>
                <div class="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 text-white text-[11px] font-medium px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg z-10">
                    ${escapeHtml(tooltipText)}
                    <div class="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-4 border-transparent border-t-slate-900"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="mb-5 rounded-lg border border-border bg-white p-4 sm:p-5">
            <h3 class="text-lg sm:text-xl font-bold mb-4 text-text">${STATUS_STEPS[currentIndex].label}</h3>
            <div class="flex items-start justify-between gap-1 px-1">
                ${nodes}
            </div>
        </div>
    `;
}

function buildStatusNotice(trip) {
    const notices = {
        [TripState.REQUESTED]: {
            style: 'bg-orange-50 border-orange-300 text-orange-800',
            iconColor: 'text-orange-500',
            title: 'Viaje solicitado',
            message: 'Un cliente pidió este viaje pero aún no tiene transportista, origen ni destino asignado. Copia el ID y resérvalo con un transportista para continuar.',
            icon: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>'
        },
        [TripState.CREATION]: {
            style: 'bg-slate-50 border-slate-300 text-slate-700',
            iconColor: 'text-slate-500',
            title: 'Viaje creado',
            message: 'Se detectó este viaje a partir de un mensaje de WhatsApp. Aún no ha sido confirmado por el transportista.',
            icon: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>'
        },
        [TripState.CONFIRMATION]: {
            style: 'bg-sky-50 border-sky-300 text-sky-800',
            iconColor: 'text-sky-500',
            title: 'Viaje confirmado',
            message: 'El transportista confirmó el viaje. Aún no ha salido hacia su destino.',
            icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
        },
        [TripState.DISPATCHED]: {
            style: 'bg-blue-50 border-blue-300 text-blue-800',
            iconColor: 'text-blue-500',
            title: 'Viaje en tránsito',
            message: 'El viaje ya salió y se encuentra en camino hacia su destino.',
            icon: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle>'
        },
        [TripState.COMPLETION]: {
            style: 'bg-emerald-50 border-emerald-300 text-emerald-800',
            iconColor: 'text-emerald-500',
            title: 'Viaje completado',
            message: 'La carga fue entregada. Este viaje ya se encuentra cerrado.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>'
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

// The schema only supports one driver per trip (trip.driver_id), so this is
// a single-name block rather than the old multi-driver assignment list.
function buildDriverInfo(trip) {
    const name = trip.transportista ? String(trip.transportista).trim() : '';

    const header = `
        <h4 class="text-sm font-bold text-primary mb-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
            </svg>
            Transportista asignado
        </h4>
    `;

    if (!name) {
        return `
            <div class="mb-2">
                ${header}
                <div class="rounded-lg border border-dashed border-border bg-white p-4 text-center text-sm text-slate-500 italic">
                    Aún no hay un transportista asignado a este viaje.
                </div>
            </div>
        `;
    }

    const initial = name.charAt(0).toUpperCase() || '?';

    return `
        <div class="mb-2">
            ${header}
            <div class="flex items-center gap-3 p-3 bg-white rounded-lg border border-border shadow-sm">
                <span class="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-icon text-white text-sm font-bold uppercase">
                    ${escapeHtml(initial)}
                </span>
                <p class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(name)}</p>
            </div>
        </div>
    `;
}

// Trip id + one-click copy button. Especially important for "requested"
// trips: the id is the only thing a coordinator needs to copy into the
// transportistas group to book the trip.
function buildTripIdBlock(trip) {
    if (!trip.id) return '';

    return `
        <div class="mb-4 flex items-center gap-2 flex-wrap">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">ID del viaje</span>
            <code class="px-2 py-1 rounded bg-slate-100 text-slate-800 text-sm font-mono break-all">${escapeHtml(trip.id)}</code>
            <button type="button"
                    class="copy-trip-id-btn flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
                    onclick="copyTripId(this, '${escapeHtml(trip.id)}')"
                    aria-label="Copiar ID del viaje">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
                <span class="copy-trip-id-label">Copiar</span>
            </button>
        </div>
    `;
}

window.copyTripId = function(btn, tripId) {
    navigator.clipboard.writeText(tripId).then(() => {
        const label = btn.querySelector('.copy-trip-id-label');
        if (!label) return;
        const original = label.textContent;
        label.textContent = 'Copiado ✓';
        clearTimeout(btn.__copyResetTimer);
        btn.__copyResetTimer = setTimeout(() => { label.textContent = original; }, 1500);
    }).catch((error) => {
        console.error('Error copying trip id: ', error);
    });
};

function buildTripDetails(trip) {
    // Already rendered by buildTripIdBlock/buildStatusBar/buildStatusNotice/
    // buildDriverInfo or the table row itself — everything else falls into
    // "extra" below (empresa, grupo, partner today).
    const usedKeys = new Set(['id', 'estado', 'origen', 'destino', 'fecha_creacion', 'transportista', 'estados', 'contenido_solicitud']);

    const prettyLabel = (key) => key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

    const formatValue = (key, value) => {
        if (value === null || value === undefined || value === '') return '<span class="text-slate-400 italic">N/A</span>';
        if (/fecha/i.test(key) && !isNaN(new Date(value).getTime())) {
            return escapeHtml(formatStateDate(value) || String(value));
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
                Detalles adicionales
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${cards}
            </div>
        `;

    const requestContentSection = trip.contenido_solicitud
        ? `
            <div class="mb-4 p-3 rounded-lg border border-orange-200 bg-orange-50">
                <p class="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1">Mensaje original del cliente</p>
                <p class="text-sm text-orange-900 break-words">${escapeHtml(trip.contenido_solicitud)}</p>
            </div>
        `
        : '';

    return `
        <div>
            ${buildTripIdBlock(trip)}
            ${buildStatusBar(trip)}
            ${buildStatusNotice(trip)}
            ${requestContentSection}
            ${buildDriverInfo(trip)}
            ${detailsSection}
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
    let exportTrips = currentFilteredTrips;

    if (groupFilter) {
        exportTrips = exportTrips.filter(t => String(t.empresa || '') === groupFilter);
    }

    if (query) {
        exportTrips = exportTrips.filter(t =>
            String(t.origen || '').toLowerCase().includes(query) ||
            String(t.destino || '').toLowerCase().includes(query)
        );
    }

    if (exportTrips.length === 0) {
        alert("No hay datos para exportar");
        return;
    }

    const headers = ["Estado", "Empresa", "Grupo WA", "Origen", "Destino", "Fecha Creación", "Transportista"];
    const csvRows = [headers.join(",")];

    exportTrips.forEach(trip => {
        const row = [
            `"${STATE_LABELS[trip.estado] || trip.estado || ''}"`,
            `"${trip.empresa || ''}"`,
            `"${trip.grupo || ''}"`,
            `"${trip.origen || ''}"`,
            `"${trip.destino || ''}"`,
            `"${trip.fecha_creacion || ''}"`,
            `"${trip.transportista || 'Sin asignar'}"`
        ];
        csvRows.push(row.join(","));
    });

    const csvString = csvRows.join("\n");

    const blob = new Blob(["﻿" + csvString], { type: 'text/csv;charset=utf-8;' });

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
