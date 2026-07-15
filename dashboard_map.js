import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
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
const db = getFirestore(app);
const auth = getAuth(app);

let allTrips = []; 
let geoChart;
let mapData;
let currentMapMode = 'origen';
let currentFilteredTrips = [];
let currentFilterName = "";
let currentDetailFilter = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('user-label').textContent = user.email;
        google.charts.load('current', {
            'packages':['geochart'],
        });
        google.charts.setOnLoadCallback(initFirebaseListener);
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

function initFirebaseListener() {
    const tripsRef = collection(db, 'viajes');
    
    onSnapshot(tripsRef, (snapshot) => {
        allTrips = [];
        let coordinado = 0, buscando = 0, atrasado = 0, completado = 0, tiempo = 0;

        snapshot.forEach((doc) => {
            const trip = doc.data();
            allTrips.push(trip);

            // const missingDriver = !trip.transportista || (typeof trip.transportista === 'string' && trip.transportista.trim() === '');
            // const unconfirmed = trip.estado === 'ofreciendo';

            // if (missingDriver || unconfirmed) incidence++;

            if (trip.estado === 'coordinado') coordinado++;
            if (trip.estado === 'buscando') buscando++;
            if (trip.estado === 'atrasado') atrasado++;
            if (trip.estado === 'completado') completado++;
            if (trip.estado === 'tiempo') tiempo++;
        });

        document.getElementById('val-total-trips').innerText = allTrips.length;

        /*Los viajes que han sido coordinados (ya tienen todos los transportistas asginados) 
        y los que ya fueron coordinados pero estan en servicio y antes de la fecha de llegada 
        estimada, son considerados a tiempo. */
        document.getElementById('val-ontime').innerText = tiempo + coordinado; 

        document.getElementById('val-delayed').innerText = atrasado;
        document.getElementById('val-incidence').innerText = buscando;
        document.getElementById('val-pendent').innerText = completado;

        processDataAndDrawMap();

        const detailView = document.getElementById('detail-view');
        if (detailView && !detailView.classList.contains('hidden') && currentDetailFilter) {
            window.showDetails(currentDetailFilter.type, currentDetailFilter.value);
        }
    });
}

function processDataAndDrawMap() {
    let stateCounts = {};

    allTrips.forEach((trip) => {
        const targetLocation = currentMapMode === 'origen' ? trip.origen : trip.destino;
        const stateCode = mapOriginToStateCode(targetLocation);
        if (stateCode) {
            stateCounts[stateCode] = (stateCounts[stateCode] || 0) + 1;
        }
    });

    drawMap(stateCounts);
}

function drawMap(stateCounts) {
    mapData = new google.visualization.DataTable();
    mapData.addColumn('string', 'Estado');
    mapData.addColumn('number', 'Viajes Activos');

    for (const [stateCode, count] of Object.entries(stateCounts)) {
        mapData.addRow([stateCode, count]);
    }

    const options = {
        region: 'MX',
        resolution: 'provinces',
        colorAxis: {
            colors: currentMapMode === 'origen' 
                ? ['#FFD5DE', '#FF6B8A', '#E52E4F']
                : ['#c1c1ee', '#6565b1', '#1A1A2E']
        },
        backgroundColor: '#f4f7f6',
        datalessRegionColor: '#eaeaea',
        defaultColor: '#f5f5f5',
    };

    const mapContainer = document.getElementById('map-div');

    if (geoChart) {
        geoChart.clearChart();
    }

    geoChart = new google.visualization.GeoChart(mapContainer);
    
    google.visualization.events.addListener(geoChart, 'select', () => {
        const selection = geoChart.getSelection();
        if (selection.length > 0) {
            const stateCode = mapData.getValue(selection[0].row, 0);
            window.showDetails('state', stateCode);
        }
    });

    geoChart.draw(mapData, options);
    
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

    google.visualization.events.addListener(geoChart, 'select', () => {
        const selection = geoChart.getSelection();
        if (selection.length > 0) {
            const stateCode = mapData.getValue(selection[0].row, 0);
            window.showDetails('state', stateCode);
        }
    });

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

    const tableBody = document.getElementById('detail-table-body');
    const cardList = document.getElementById('detail-card-list');
    tableBody.innerHTML = '';
    if (cardList) cardList.innerHTML = '';

    if (filterType === 'status') {
        if (filterValue === 'incidencias') {
            document.getElementById('table-title').innerText = 'Viajes filtrados que presentan al menos una incidencia';
            currentFilteredTrips = allTrips.filter(t => {
                const missingDriver = !t.transportista || (typeof t.transportista === 'string' && t.transportista.trim() === '');
                const unconfirmed = t.estado === 'ofreciendo';

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
            const targetLocation = currentMapMode === 'origen' ? t.origen : t.destino;
            return mapOriginToStateCode(targetLocation) === filterValue;
        });
    } else {
        document.getElementById('table-title').innerText = 'Mostrando todos los viajes';
        currentFilteredTrips = allTrips;
        currentFilterName = "all_trips";
    }

    if (currentFilteredTrips.length === 0) {
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
        return;
    }

    currentFilteredTrips.forEach((trip, index) => {
        let badgeStyle = "bg-slate-100 text-slate-800";
        if(trip.estado === 'coordinando' || trip.estado === 'coordinado') badgeStyle = "bg-green-100 text-green-800";
        if(trip.estado === 'buscando') badgeStyle = "bg-amber-100 text-amber-800";
        if(trip.estado === 'ofreciendo') badgeStyle = "bg-red-100 text-red-800";
        if(trip.estado === 'atrasado') badgeStyle = "bg-red-100 text-red-800";
        if(trip.estado === 'pendiente') badgeStyle = "bg-blue-100 text-blue-800";
        if(trip.estado === 'completado') badgeStyle = "bg-emerald-100 text-emerald-800";
        if(trip.estado === 'tiempo') badgeStyle = "bg-sky-100 text-sky-800";

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
                    ${trip.estado}
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
                            ${trip.estado || 'N/A'}
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
};

function buildTripDetails(trip) {
    const usedKeys = new Set([
        'estado', 'origen', 'destino', 'fecha_salida',
        'tipo_carga', 'cantidadActualDeTransportistas', 'cantidadTransportistas'
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

    if (extraEntries.length === 0) {
        return '<p class="text-sm text-slate-500 italic">No hay información adicional para este viaje.</p>';
    }

    const cards = extraEntries.map(([key, value]) => `
        <div class="bg-white rounded-lg p-4 border border-border shadow-sm">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${escapeHtml(prettyLabel(key))}</div>
            <div class="text-sm text-slate-800 break-words">${formatValue(key, value)}</div>
        </div>
    `).join('');

    return `
        <div>
            ${buildStatusNotice(trip)}
            <h4 class="text-sm font-bold text-primary mb-3 flex items-center gap-2">
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
        </div>
    `;
}

function buildStatusNotice(trip) {
    const notices = {
        buscando: {
            style: 'bg-amber-50 border-amber-300 text-amber-800',
            iconColor: 'text-amber-500',
            title: 'Búsqueda de transportistas en curso',
            message: 'Este viaje aún no cuenta con todos los transportistas solicitados. Se sigue buscando cobertura para completar la asignación.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path>'
        },
        coordinado: {
            style: 'bg-sky-50 border-sky-300 text-sky-800',
            iconColor: 'text-sky-500',
            title: 'Viaje coordinado',
            message: 'Este viaje ya está coordinado. La fecha de salida se encuentra programada para una fecha futura y todos los transportistas están asignados.',
            icon: '<path d="M20 6 9 17l-5-5"></path>'
        },
        atrasado: {
            style: 'bg-red-50 border-red-300 text-red-800',
            iconColor: 'text-red-500',
            title: 'Viaje con atraso',
            message: 'Este viaje no ha sido completado y ya superó la fecha de llegada estimada (7 días por defecto). Se recomienda revisar el estatus con el transportista.',
            icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>'
        },
        completado: {
            style: 'bg-emerald-50 border-emerald-300 text-emerald-800',
            iconColor: 'text-emerald-500',
            title: 'Viaje completado',
            message: 'Este viaje se ha completado con éxito. La carga fue entregada dentro del periodo establecido.',
            icon: '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>'
        },
        tiempo: {
            style: 'bg-green-50 border-green-300 text-green-800',
            iconColor: 'text-green-500',
            title: 'Viaje en tiempo',
            message: 'Este viaje se encuentra en servicio y avanza dentro del tiempo estimado hacia su destino.',
            icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
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
    if (currentFilteredTrips.length === 0) {
        alert("No hay datos para exportar");
        return;
    }

    const headers = ["Estado", "Origen", "Destino", "Fecha Salida", "Tipo Carga", "Transportista"];
    const csvRows = [headers.join(",")];

    currentFilteredTrips.forEach(trip => {
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