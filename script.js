
// ------------------------------------
// 1. MAP SETUP
// ------------------------------------

const maptilerKey = "2E4wY5kv31hlD5duk20H";

const map = L.map("map").setView(
  [51.5072, -0.1276],
  13
);

L.tileLayer(
  `https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${maptilerKey}`,
  {
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,
    attribution:
      '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors',
    crossOrigin: true
  }
).addTo(map);


// ------------------------------------
// 2. LOAD AND SAVE DATA
// ------------------------------------

function loadSavedData(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.error("Could not load saved data:", error);
    return fallback;
  }
}

function saveMapData() {
  localStorage.setItem(
    "invisibleMapRoute",
    JSON.stringify(routeCoordinates)
  );

  localStorage.setItem(
    "invisibleMapPins",
    JSON.stringify(savedPins)
  );
}


// Load existing route data
let routeCoordinates = loadSavedData(
  "invisibleMapRoute",
  []
);

// Keep only valid GPS coordinates
routeCoordinates = routeCoordinates.filter(position =>
  Array.isArray(position) &&
  position.length === 2 &&
  Number.isFinite(position[0]) &&
  Number.isFinite(position[1]) &&
  Math.abs(position[0]) <= 90 &&
  Math.abs(position[1]) <= 180
);


// Load saved pins
let savedPins = loadSavedData(
  "invisibleMapPins",
  []
);

// Keep only valid pins
savedPins = savedPins.filter(pin =>
  pin &&
  Number.isFinite(pin.lat) &&
  Number.isFinite(pin.lng) &&
  Math.abs(pin.lat) <= 90 &&
  Math.abs(pin.lng) <= 180
);


// ------------------------------------
// 3. MAP LAYERS
// ------------------------------------

map.createPane("fogPane");
map.getPane("fogPane").style.zIndex = 450;

map.createPane("memoryPane");
map.getPane("memoryPane").style.zIndex = 460;


// Route line
const routeLine = L.polyline(routeCoordinates, {
  color: "#333333",
  weight: 2,
  opacity: 0.35,
  pane: "memoryPane"
}).addTo(map);


// Memory circles
const memoryLayer = L.layerGroup().addTo(map);


// Pin layer
const pinLayer = L.layerGroup().addTo(map);


// Draw saved memory circles
function drawMemoryCircles() {

  memoryLayer.clearLayers();

  routeCoordinates.forEach(position => {

    L.circle(position, {
      radius: 20,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.08,
      pane: "memoryPane"
    }).addTo(memoryLayer);

  });

}


// Draw saved pins
function drawPins() {

  pinLayer.clearLayers();

  savedPins.forEach(pin => {

    L.marker([pin.lat, pin.lng]).addTo(pinLayer);

  });

}


drawMemoryCircles();
drawPins();


// Restore saved route position
if (routeCoordinates.length > 1) {

  map.fitBounds(routeLine.getBounds(), {
    padding: [30, 30]
  });

} else if (routeCoordinates.length === 1) {

  map.setView(routeCoordinates[0], 16);

}


// ------------------------------------
// 4. ADD PIN FUNCTIONALITY
// ------------------------------------

let addingPin = false;

const addPinButton = document.getElementById("addPinButton");

L.DomEvent.disableClickPropagation(addPinButton);

addPinButton.addEventListener("click", () => {

  addingPin = !addingPin;

  if (addingPin) {
    addPinButton.textContent = "×";
    addPinButton.title = "Cancel adding a pin";
  } else {
    addPinButton.textContent = "+";
    addPinButton.title = "Add a pin";
  }

});


map.on("click", event => {

  if (!addingPin) return;

  const newPin = {
    lat: event.latlng.lat,
    lng: event.latlng.lng
  };

  // Add pin to saved data
  savedPins.push(newPin);

  // Draw the pin
  L.marker(event.latlng).addTo(pinLayer);

  // Save everything
  saveMapData();

  // Exit pin mode
  addingPin = false;
  addPinButton.textContent = "+";
  addPinButton.title = "Add a pin";

});


// ------------------------------------
// 5. FOG / REVEAL EFFECT
// ------------------------------------

let fogLayer = null;


function updateFogLayer() {

  if (fogLayer !== null) {
    map.removeLayer(fogLayer);
  }

  const bounds = map.getBounds().pad(0.5);

  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  const outerRing = [
    [southWest.lat, southWest.lng],
    [southWest.lat, northEast.lng],
    [northEast.lat, northEast.lng],
    [northEast.lat, southWest.lng],
    [southWest.lat, southWest.lng]
  ];

  const holes = [];

  if (routeCoordinates.length > 0) {

    let routeFeature;

    if (routeCoordinates.length === 1) {

      const position = routeCoordinates[0];

      routeFeature = turf.point([
        position[1],
        position[0]
      ]);

    } else {

      const coordinates = routeCoordinates.map(position => [
        position[1],
        position[0]
      ]);

      routeFeature = turf.lineString(coordinates);

    }

    const revealedArea = turf.buffer(
      routeFeature,
      65,
      { units: "meters" }
    );

    if (revealedArea.geometry.type === "Polygon") {

      holes.push(
        revealedArea.geometry.coordinates[0].map(point => [
          point[1],
          point[0]
        ])
      );

    } else if (revealedArea.geometry.type === "MultiPolygon") {

      revealedArea.geometry.coordinates.forEach(polygon => {

        holes.push(
          polygon[0].map(point => [
            point[1],
            point[0]
          ])
        );

      });

    }

  }

  fogLayer = L.polygon(
    [outerRing, ...holes],
    {
      stroke: false,
      fillColor: "#f4f1eb",
      fillOpacity: 0.72,
      fillRule: "evenodd",
      interactive: false,
      pane: "fogPane"
    }
  ).addTo(map);

}


updateFogLayer();

map.on("moveend zoomend", updateFogLayer);


// ------------------------------------
// 6. GPS TRACKING
// ------------------------------------

const trackingButton = document.getElementById("trackingButton");
const trackingStatus = document.getElementById("trackingStatus");

let tracking = false;
let watchId = null;
let currentLocationMarker = null;


trackingButton.addEventListener("click", () => {

  if (tracking) {
    stopTracking();
  } else {
    startTracking();
  }

});


function startTracking() {

  if (!navigator.geolocation) {

    trackingStatus.textContent =
      "GPS is not supported by this browser";

    return;

  }

  tracking = true;

  trackingButton.textContent = "Stop tracking";
  trackingStatus.textContent = "Waiting for GPS...";

  watchId = navigator.geolocation.watchPosition(

    position => {

      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      if (accuracy > 1000) {

        trackingStatus.textContent =
          "Location accuracy too low: " +
          Math.round(accuracy) + " metres";

        return;

      }

      const newPosition = [latitude, longitude];

      map.setView(newPosition, 16);

      // Create or update location marker
      if (currentLocationMarker === null) {

        currentLocationMarker = L.circleMarker(newPosition, {
          radius: 8,
          color: "#ffffff",
          weight: 3,
          fillColor: "#000000",
          fillOpacity: 1
        }).addTo(map);

      } else {

        currentLocationMarker.setLatLng(newPosition);

      }


      // Ignore movements smaller than 5 metres
      if (routeCoordinates.length > 0) {

        const lastPosition =
          routeCoordinates[routeCoordinates.length - 1];

        const distance = map.distance(
          lastPosition,
          newPosition
        );

        if (distance < 5) {

          trackingStatus.textContent = "GPS tracking active";
          return;

        }

      }


      // Add new GPS position
      routeCoordinates.push(newPosition);

      routeLine.setLatLngs(routeCoordinates);


      // Add memory circle
      L.circle(newPosition, {
        radius: 20,
        stroke: false,
        fillColor: "#222222",
        fillOpacity: 0.08,
        pane: "memoryPane"
      }).addTo(memoryLayer);


      // Update reveal effect
      updateFogLayer();


      // Save route and pins
      saveMapData();

      trackingStatus.textContent = "GPS tracking active";

    },


    error => {

      if (error.code === 1) {

        trackingStatus.textContent =
          "Location permission denied";

        stopTracking();

      } else if (error.code === 2) {

        trackingStatus.textContent =
          "GPS position unavailable";

      } else if (error.code === 3) {

        trackingStatus.textContent =
          "GPS request timed out. Still trying...";

      }

    },


    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }

  );

}


// ------------------------------------
// 7. STOP GPS TRACKING
// ------------------------------------

function stopTracking() {

  if (watchId !== null) {

    navigator.geolocation.clearWatch(watchId);
    watchId = null;

  }

  tracking = false;

  trackingButton.textContent = "Start tracking";
  trackingStatus.textContent = "Tracking is off";

}


// ------------------------------------
// 8. EXPORT MAP DATA
// ------------------------------------

const exportButton = document.getElementById("exportButton");

exportButton.addEventListener("click", () => {

  const backup = {
    app: "The Invisible Map",
    version: 1,
    exportedAt: new Date().toISOString(),
    route: routeCoordinates,
    pins: savedPins
  };

  const file = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const fileURL = URL.createObjectURL(file);

  const downloadLink = document.createElement("a");

  downloadLink.href = fileURL;
  downloadLink.download = "invisible-map-backup.json";

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);

  setTimeout(() => {
    URL.revokeObjectURL(fileURL);
  }, 1000);

});


// ------------------------------------
// 9. IMPORT MAP DATA
// ------------------------------------

const importButton = document.getElementById("importButton");
const importFile = document.getElementById("importFile");

importButton.addEventListener("click", () => {

  importFile.click();

});


importFile.addEventListener("change", event => {

  const file = event.target.files[0];

  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {

    try {

      const backup = JSON.parse(reader.result);

      // Check the backup structure
      if (
        backup.app !== "The Invisible Map" ||
        !Array.isArray(backup.route) ||
        !Array.isArray(backup.pins)
      ) {

        alert("This file is not a valid Invisible Map backup.");
        return;

      }

      // Validate imported route
      const validRoute = backup.route.every(position =>
        Array.isArray(position) &&
        position.length === 2 &&
        Number.isFinite(position[0]) &&
        Number.isFinite(position[1]) &&
        Math.abs(position[0]) <= 90 &&
        Math.abs(position[1]) <= 180
      );

      // Validate imported pins
      const validPins = backup.pins.every(pin =>
        pin &&
        Number.isFinite(pin.lat) &&
        Number.isFinite(pin.lng) &&
        Math.abs(pin.lat) <= 90 &&
        Math.abs(pin.lng) <= 180
      );

      if (!validRoute || !validPins) {

        alert("The backup contains invalid map data.");
        return;

      }

      const confirmed = confirm(
        "Import this backup? Your current route and pins on this device will be replaced."
      );

      if (!confirmed) return;


      // Replace current data
      routeCoordinates = backup.route;
      savedPins = backup.pins;


      // Redraw map layers
      routeLine.setLatLngs(routeCoordinates);

      drawMemoryCircles();
      drawPins();

      // Update saved data
      saveMapData();

      // Update the reveal effect
      updateFogLayer();


      // Adjust map view
      if (routeCoordinates.length > 1) {

        map.fitBounds(routeLine.getBounds(), {
          padding: [30, 30]
        });

      } else if (routeCoordinates.length === 1) {

        map.setView(routeCoordinates[0], 16);

      } else if (savedPins.length > 0) {

        map.setView(
          [savedPins[0].lat, savedPins[0].lng],
          16
        );

      }

      alert("Your map backup was imported successfully!");

    } catch (error) {

      alert("Could not read this backup file.");

      console.error(error);

    } finally {

      // Allow selecting the same file again
      importFile.value = "";

    }

  };

  reader.readAsText(file);

});
