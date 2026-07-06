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
        let onTime = 0, delayed = 0, incidence = 0, pendent = 0;

        snapshot.forEach((doc) => {
            const trip = doc.data();
            allTrips.push(trip);

            const missingDriver = !trip.transportista || (typeof trip.transportista === 'string' && trip.transportista.trim() === '');
            const unconfirmed = trip.estado === 'ofreciendo';

            if (missingDriver || unconfirmed) incidence++;
            if (trip.estado === 'coordinando') onTime++;
            if (trip.estado === 'buscando') delayed++;
            if (trip.estado === 'pendiente') pendent++;
        });

        document.getElementById('val-total-trips').innerText = allTrips.length;
        document.getElementById('val-ontime').innerText = onTime;
        document.getElementById('val-delayed').innerText = delayed;
        document.getElementById('val-incidence').innerText = incidence;
        document.getElementById('val-pendent').innerText = pendent;

        processDataAndDrawMap();
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

    const mapContainer = document.getElementById('map_div');

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
    
    const tableBody = document.getElementById('detail-table-body');
    tableBody.innerHTML = ''; 

    let filteredTrips = [];

    if (filterType === 'status') {
        if (filterValue === 'incidencias') {
            document.getElementById('table-title').innerText = 'Viajes filtrados que presentan al menos una incidencia';
            currentFilteredTrips = allTrips.filter(t => {
                const missingDriver = !t.transportista || (typeof t.transportista === 'string' && t.transportista.trim() === '');
                const unconfirmed = t.estado === 'ofreciendo';

                return missingDriver || unconfirmed;
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

    currentFilteredTrips.forEach(trip => {
        
        let badgeStyle = "bg-slate-100 text-slate-800";
        if(trip.estado === 'coordinando') badgeStyle = "bg-green-100 text-green-800";
        if(trip.estado === 'buscando') badgeStyle = "bg-amber-100 text-amber-800";
        if(trip.estado === 'ofreciendo') badgeStyle = "bg-red-100 text-red-800";
        if(trip.estado === 'pendiente') badgeStyle = "bg-blue-100 text-blue-800";

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50 transition-colors";
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${badgeStyle}">
                    ${trip.estado}
                </span>
            </td>
            <td class="px-6 py-4 font-medium text-slate-800">${trip.origen}</td>
            <td class="px-6 py-4 text-slate-600">${trip.destino}</td>
            <td class="px-6 py-4 text-slate-600">${trip.fecha_salida}</td>
            <td class="px-6 py-4 text-slate-600">${trip.tipo_carga || 'N/A'}</td>
        `;
        let driverCell = '<td class="px-6 py-4';
        if (trip.transportista) {
            driverCell += ' text-slate-600">';
        } else {
            driverCell += ' text-red-600">';
        }
        row.innerHTML += `${driverCell}${trip.transportista || 'Sin Asignar'}</td>`;
        tableBody.appendChild(row);
    });
};

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
    
    processDataAndDrawMap();
};

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