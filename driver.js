// --- WebSocket setup ---
const socket = new WebSocket('ws://localhost:3000');
const binMarkers = new Map(); // Map<binId, Leaflet marker>
let routeControl = null; // For the routing control
let currentRoute = null; // Current route polyline

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
const nearestBinBtn = document.getElementById('nearestBinBtn');
const fullBinsBtn = document.getElementById('fullBinsBtn');
const optimizeRouteBtn = document.getElementById('optimizeRouteBtn');
const routePanel = document.getElementById('route-panel');

// Modified to remove auto-zoom when enabling location
function startTracking() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    currentPosition = [lat, lng];
    if (!userMarker) {
      userMarker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448636.png', // Truck icon
          iconSize: [40, 40], 
          iconAnchor: [20, 40], 
          popupAnchor: [0, -40]
        })
      }).addTo(map).bindPopup('Your truck location');
    } else {
      userMarker.setLatLng([lat, lng]);
    }
    userMarker.bindPopup(`Your truck location<br>Distance to campus: ${map.distance([lat, lng], [13.94827, 120.71993]).toFixed(1)} m`);
    gtmlBtn.disabled = false;
    
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ 
        type: 'driverlocation', 
        latitude: lat, 
        longitude: lng
      }));
    }
    
    // Removed any auto-zoom code here
  }, () => {
    Swal.fire('Error', 'Unable to retrieve location', 'error');
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
      text: 'This will track your truck location but won\'t automatically zoom to it.',
      confirmButtonColor: '#ca8a04' 
    }).then((result) => {
      if (result.isConfirmed) {
        startTracking();
        gtmlBtn.disabled = true;
      }
    });
  }
}

// --- Bin Status Management ---
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
    title: 'Trash Bin',
    html: `
      <p><strong>Status:</strong> ${marker.binStatus || 'Not set'}</p>
      <p><strong>Location:</strong> ${marker.getLatLng().lat.toFixed(5)}, ${marker.getLatLng().lng.toFixed(5)}</p>
    `,
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Mark as Collected',
    cancelButtonText: 'Close',
    confirmButtonColor: '#ca8a04',
    cancelButtonColor: '#6b7280'
  }).then(result => {
    if (result.isConfirmed) {
      // Mark bin as collected/empty
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'updatebinstatus',
          id: marker.binId,
          status: 'empty'
        }));
        
        Swal.fire({
          title: 'Bin Collected',
          text: 'Bin has been marked as empty',
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });
      }
    }
  });
}

// --- Route Management ---
function findNearestBin() {
  if (!currentPosition) {
    Swal.fire('Error', 'Please enable location tracking first', 'error');
    return;
  }
  
  if (binMarkers.size === 0) {
    Swal.fire('No Bins', 'No trash bins are available on the map', 'info');
    return;
  }
  
  let nearestBin = null;
  let shortestDistance = Infinity;
  
  // Find the nearest bin
  binMarkers.forEach(marker => {
    const distance = map.distance(currentPosition, marker.getLatLng());
    if (distance < shortestDistance) {
      shortestDistance = distance;
      nearestBin = marker;
    }
  });
  
  if (nearestBin) {
    // Create a route to the nearest bin
    if (routeControl) {
      map.removeControl(routeControl);
    }
    
    routeControl = L.Routing.control({
      waypoints: [
        L.latLng(currentPosition[0], currentPosition[1]),
        nearestBin.getLatLng()
      ],
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: false, // Don't auto-zoom to the route
      lineOptions: {
        styles: [{ color: '#ca8a04', weight: 5, opacity: 0.7 }]
      }
    }).addTo(map);
    
    // Show route panel with information
    routePanel.style.display = 'block';
    
    // Update route information when route is calculated
    routeControl.on('routesfound', function(e) {
      const routes = e.routes;
      const summary = routes[0].summary;
      
      // Update route stats
      document.getElementById('route-distance').textContent = (summary.totalDistance / 1000).toFixed(1);
      document.getElementById('route-time').textContent = Math.round(summary.totalTime / 60);
      document.getElementById('route-bins').textContent = '1';
    });
    
    // Highlight the selected bin
    nearestBin.setIcon(getBinIcon('full')); // Temporarily highlight it
    setTimeout(() => {
      nearestBin.setIcon(getBinIcon(nearestBin.binStatus)); // Reset after 2 seconds
    }, 2000);
  }
}

function showFullBins() {
  if (binMarkers.size === 0) {
    Swal.fire('No Bins', 'No trash bins are available on the map', 'info');
    return;
  }
  
  let fullBinsCount = 0;
  
  // Hide all bins first
  binMarkers.forEach(marker => {
    marker.setOpacity(0.3);
  });
  
  // Show only full bins
  binMarkers.forEach(marker => {
    if (marker.binStatus === 'full') {
      marker.setOpacity(1);
      fullBinsCount++;
    }
  });
  
  if (fullBinsCount === 0) {
    Swal.fire('No Full Bins', 'There are no full bins at the moment', 'info');
    // Reset opacity
    binMarkers.forEach(marker => {
      marker.setOpacity(1);
    });
  } else {
    Swal.fire({
      title: 'Full Bins',
      text: `Showing ${fullBinsCount} full bins on the map`,
      icon: 'success',
      timer: 1500,
      showConfirmButton: false
    });
    
    // Add a button to reset the view
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Show All Bins';
    resetButton.className = 'btn';
    resetButton.style.position = 'absolute';
    resetButton.style.top = '10px';
    resetButton.style.left = '10px';
    resetButton.style.zIndex = '1000';
    resetButton.onclick = function() {
      binMarkers.forEach(marker => {
        marker.setOpacity(1);
      });
      this.remove();
    };
    
    document.getElementById('map-wrapper').appendChild(resetButton);
  }
}

function optimizeRoute() {
  if (!currentPosition) {
    Swal.fire('Error', 'Please enable location tracking first', 'error');
    return;
  }
  
  // Get all full bins
  const fullBins = [];
  binMarkers.forEach(marker => {
    if (marker.binStatus === 'full' || marker.binStatus === 'half') {
      fullBins.push(marker);
    }
  });
  
  if (fullBins.length === 0) {
    Swal.fire('No Bins', 'No bins need collection at the moment', 'info');
    return;
  }
  
  // Create waypoints starting with current position
  const waypoints = [L.latLng(currentPosition[0], currentPosition[1])];
  
  // Add full bins to waypoints
  fullBins.forEach(bin => {
    waypoints.push(bin.getLatLng());
  });
  
  // Create or update the route
  if (routeControl) {
    map.removeControl(routeControl);
  }
  
  routeControl = L.Routing.control({
    waypoints: waypoints,
    routeWhileDragging: false,
    showAlternatives: false,
    fitSelectedRoutes: false, // Don't auto-zoom to the route
    lineOptions: {
      styles: [{ color: '#ca8a04', weight: 5, opacity: 0.7 }]
    }
  }).addTo(map);
  
  // Show route panel with information
  routePanel.style.display = 'block';
  
  // Update route information when route is calculated
  routeControl.on('routesfound', function(e) {
    const routes = e.routes;
    const summary = routes[0].summary;
    
    // Update route stats
    document.getElementById('route-distance').textContent = (summary.totalDistance / 1000).toFixed(1);
    document.getElementById('route-time').textContent = Math.round(summary.totalTime / 60);
    document.getElementById('route-bins').textContent = fullBins.length;
  });
  
  Swal.fire({
    title: 'Route Optimized',
    text: `Created route to collect ${fullBins.length} bins`,
    icon: 'success',
    timer: 1500,
    showConfirmButton: false
  });
}

function clearRoute() {
  if (routeControl) {
    map.removeControl(routeControl);
    routeControl = null;
  }
  
  // Hide route panel
  routePanel.style.display = 'none';
  
  Swal.fire({
    title: 'Route Cleared',
    text: 'The route has been cleared from the map',
    icon: 'success',
    timer: 1500,
    showConfirmButton: false
  });
}

function startRoute() {
  findNearestBin();
}

gtmlBtn.addEventListener('click', goToMyLocation);

// --- Route tracking ---
let isRouteActive = false;
let currentRouteId = null;

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
  
  // Hide route panel initially
  routePanel.style.display = 'none';
  
  // Add event listeners
  nearestBinBtn.addEventListener('click', findNearestBin);
  fullBinsBtn.addEventListener('click', showFullBins);
  optimizeRouteBtn.addEventListener('click', optimizeRoute);
});

// Handle connection errors
socket.addEventListener('error', () => {
  Swal.fire('Connection Error', 'Failed to connect to the server', 'error');
});

socket.addEventListener('close', () => {
  Swal.fire('Connection Lost', 'Connection to the server was lost', 'warning');
});