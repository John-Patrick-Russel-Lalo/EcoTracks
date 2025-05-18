// --- WebSocket setup ---
const socket = new WebSocket('wss://ecotrack-server-v9i3.onrender.com');
const binMarkers = new Map(); // Map<binId, Leaflet marker>

// --- Leaflet map setup ---
const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
});
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20,
  attribution: '&copy; Esri'
});
const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; CartoDB'
});
const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  attribution: '&copy; CartoDB'
});

const map = L.map('map', {
  center: [13.94827, 120.71993],
  zoom: 14,
  layers: [streets]
});

L.control.layers({
  "Streets": streets,
  "Satellite": satellite,
  "Dark": dark,
  "Light": light
}).addTo(map);

L.marker([13.94827, 120.71993])
  .addTo(map)
  .bindPopup("<b>Batangas State University Balayan Campus</b>")
  .openPopup();

// --- Search ---
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');

searchInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') searchBtn.click();
});
searchBtn.addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (!q) return;
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`)
    .then(r => r.json())
    .then(results => {
      if (!results.length) return Swal.fire('Not found', 'Place not found', 'error');
      const place = results[0];
      if (place.boundingbox) {
        const b = place.boundingbox.map(Number);
        map.fitBounds([[b[0], b[2]], [b[1], b[3]]], { padding: [50, 50] });
      } else {
        map.setView([parseFloat(place.lat), parseFloat(place.lon)], 20);
      }
    })
    .catch(() => Swal.fire('Error', 'Something went wrong', 'error'));
});

// --- Geolocation buttons ---
let watchId = null, currentPosition = null, userMarker = null;
const gtmlBtn = document.getElementById('gtmlBtn');
const addMarkBtn = document.getElementById('addMarkBtn');

// Modified to remove auto-zoom when enabling location
function startTracking() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    currentPosition = [lat, lng];
    if (!userMarker) {
      userMarker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl: 'pinUser.png',
          iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
        })
      }).addTo(map).bindPopup('You are here!');
    } else {
      userMarker.setLatLng([lat, lng]);
    }
    userMarker.bindPopup(`You are here!<br>Distance to campus: ${map.distance([lat, lng], [13.94827, 120.71993]).toFixed(1)} m`);
    gtmlBtn.disabled = false;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'location', latitude: lat, longitude: lng }));
    }
    
    // Removed any auto-zoom code here
  }, () => {
    alert('Unable to retrieve location');
    gtmlBtn.disabled = false;
  }, { enableHighAccuracy: true });
}

// This function is only called when the user explicitly clicks the "My Location" button
function goToMyLocation() {
  if (currentPosition) {
    map.setView(currentPosition, 18);
  } else {
    Swal.fire({ 
      title: 'Enable Location?', 
      text: 'This will track your location but won\'t automatically zoom to it.',
      confirmButtonColor: '#2c3e50' 
    }).then((result) => {
      if (result.isConfirmed) {
        startTracking();
        gtmlBtn.disabled = true;
      }
    });
  }
}

gtmlBtn.addEventListener('click', goToMyLocation);

// --- Bin placement ---
let placingBin = false;
function enableBinPlacement() {
  placingBin = true;
  addMarkBtn.textContent = 'Click Map to Mark';
  addMarkBtn.style.backgroundColor = '#272727';
  addMarkBtn.style.color = '#fff';
}
addMarkBtn.addEventListener('click', enableBinPlacement);

map.on('click', e => {
  if (!placingBin) return;
  const { lat, lng } = e.latlng;
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'trashbin', latitude: lat, longitude: lng }));
  }
  placingBin = false;
  addMarkBtn.textContent = '+ Add Garbage Mark';
  addMarkBtn.style.backgroundColor = '#fff';
  addMarkBtn.style.color = '#000';
});

// --- Bin Status Management ---
let selectedBinId = null;
let selectedStatus = null;
const binStatusPanel = document.getElementById('bin-status-panel');

// Function to show the bin status panel
function showBinStatusPanel(binId) {
  selectedBinId = binId;
  binStatusPanel.style.display = 'block';
  clearSelectedStatus();
  
  // If the bin already has a status, pre-select it
  const marker = binMarkers.get(binId);
  if (marker && marker.binStatus) {
    selectStatus(marker.binStatus);
  }
}

// Function to hide the bin status panel
function hideBinStatusPanel() {
  binStatusPanel.style.display = 'none';
  selectedBinId = null;
  selectedStatus = null;
}

// Function to select a status
function selectStatus(status) {
  selectedStatus = status;
  
  // Update UI to show selected status
  clearSelectedStatus();
  const statusElements = document.querySelectorAll('.status-option');
  statusElements.forEach(el => {
    if (el.classList.contains(`status-${status}`)) {
      el.classList.add('selected');
    }
  });
}

// Function to clear selected status
function clearSelectedStatus() {
  const statusElements = document.querySelectorAll('.status-option');
  statusElements.forEach(el => {
    el.classList.remove('selected');
  });
}

// Function to update bin status
function updateBinStatus() {
  if (!selectedBinId || !selectedStatus) {
    Swal.fire('Error', 'Please select a status for the bin', 'error');
    return;
  }
  
  // Send the status update to the server via WebSocket
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'updatebinstatus',
      id: selectedBinId,
      status: selectedStatus
    }));
    
    // Hide the panel after updating
    hideBinStatusPanel();
  } else {
    Swal.fire('Error', 'Connection to server lost. Please refresh the page.', 'error');
  }
}

// Function to cancel status update
function cancelStatusUpdate() {
  hideBinStatusPanel();
}

// --- Get bin icon based on status ---
function getBinIcon(status) {
  let iconColor;
  
  switch(status) {
    case 'empty':
      iconColor = '#22c55e'; // Green
      break;
    case 'half':
      iconColor = '#eab308'; // Yellow
      break;
    case 'full':
      iconColor = '#ef4444'; // Red
      break;
    default:
      iconColor = '#22c55e'; // Default to green
  }
  
  // Create a custom icon using SVG
  return L.divIcon({
    html: `
      <svg viewBox="0 0 24 24" width="30" height="30" fill="${iconColor}" stroke="#000" stroke-width="0.5">
        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
    `,
    className: 'bin-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30]
  });
}

// --- Marker interactions ---
function handleBinClick(marker) {
  Swal.fire({
    title: 'Trash Bin Options',
    html: `Status: <strong>${marker.binStatus || 'Not set'}</strong>`,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'Update Status',
    denyButtonText: 'Info',
    cancelButtonText: 'Delete',
    confirmButtonColor: '#16a34a',
    denyButtonColor: '#2c3e50',
    cancelButtonColor: '#e74c3c'
  }).then(result => {
    const id = marker.binId;
    if (result.isConfirmed) {
      // Show status update panel
      showBinStatusPanel(id);
    } else if (result.isDenied) {
      // Show bin info
      Swal.fire({
        title: 'Bin Information',
        html: `
          <p><strong>ID:</strong> ${id}</p>
          <p><strong>Status:</strong> ${marker.binStatus || 'Not set'}</p>
          <p><strong>Location:</strong> ${marker.getLatLng().lat.toFixed(5)}, ${marker.getLatLng().lng.toFixed(5)}</p>
        `,
        icon: 'info'
      });
    } else if (result.dismiss === Swal.DismissReason.cancel) {
      // Delete bin
      map.removeLayer(marker);
      binMarkers.delete(id);
      socket.send(JSON.stringify({ type: 'deletebin', id }));
    }
  });
}

// --- WebSocket messaging ---
socket.addEventListener('message', ev => {
  let data;
  try { data = JSON.parse(ev.data); }
  catch { return; }

  if (data.type === 'trashbin') {
    // Create marker with status if available
    const status = data.status || 'empty';
    const icon = getBinIcon(status);
    
    const m = L.marker([data.latitude, data.longitude], { icon }).addTo(map);
    m.binId = data.id;
    m.binStatus = status;
    binMarkers.set(data.id, m);
    
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    m.bindPopup(`<b>Trash Bin</b><br>Status: ${statusText}`);
    
    m.on('click', () => handleBinClick(m));
  }

  else if (data.type === 'editbin') {
    const m = binMarkers.get(data.id);
    if (m) {
      m.setLatLng([data.latitude, data.longitude]);
      // Update status if provided
      if (data.status && m.binStatus !== data.status) {
        m.binStatus = data.status;
        m.setIcon(getBinIcon(data.status));
        const statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);
        m.bindPopup(`<b>Trash Bin</b><br>Status: ${statusText}`);
      }
    }
  }

  else if (data.type === 'deletebin') {
    const m = binMarkers.get(data.id);
    if (m) {
      map.removeLayer(m);
      binMarkers.delete(data.id);
    }
  }

  else if (data.type === 'binstatus') {
    const m = binMarkers.get(data.id);
    if (m) {
      m.binStatus = data.status;
      m.setIcon(getBinIcon(data.status));
      const statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);
      m.bindPopup(`<b>Trash Bin</b><br>Status: ${statusText}`);
    }
  }
});

// Initialize the UI
document.addEventListener('DOMContentLoaded', () => {
  // Set the text for the "Go to My Location" button
  document.getElementById('gtmlBtn').textContent = 'My Location';
});

// Handle connection errors
socket.addEventListener('error', () => {
  Swal.fire('Connection Error', 'Failed to connect to the server', 'error');
});

socket.addEventListener('close', () => {
  Swal.fire('Connection Lost', 'Connection to the server was lost', 'warning');
});