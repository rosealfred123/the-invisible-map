
// ==========================================
// THE INVISIBLE MAP
// Main JavaScript
// ==========================================


// 1. MAP SETUP
// ==========================================

// IMPORTANT: Put your new, restricted MapTiler key here.
const maptilerKey = "2E4wY5kv31hlD5duk20H";

const map = L.map("map", {
  zoomControl: false
}).setView([51.5074, -0.1278], 13);

L.tileLayer(
  `https://api.maptiler.com/maps/dataviz-v4/{z}/{x}/{y}.png?key=${maptilerKey}`,
  {
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,
    attribution:
      '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors'
  }
).addTo(map);

L.control.zoom({
  position: "bottomright"
}).addTo(map);


// 2. MAP PANES
// ==========================================

map.createPane("fogPane");
map.getPane("fogPane").style.zIndex = 450;

map.createPane("memoryPane");
map.getPane("memoryPane").style.zIndex = 460;


// 3. DATA
// ==========================================

let routeCoordinates = [];
let pins = [];

let tracking = false;
let watchId = null;
let addingPin = false;

let currentPositionMarker = null;

const ROUTE_STORAGE_KEY = "invisibleMapRoute";
const PINS_STORAGE_KEY = "invisibleMapPins";


// 4. LAYERS
// ==========================================

const routeLayer = L.layerGroup({
  pane: "memoryPane"
}).addTo(map);

const pinLayer = L.layerGroup({
  pane: "memoryPane"
}).addTo(map);

const fogLayer = L.geoJSON(null, {
  pane: "fogPane",
  style: {
    fillColor: "#000000",
    fillOpacity: 0.60,
    color: "#EAE5DA",
    opacity: 0,
    weight: 0,
    fillRule: "evenodd"
  }
}).addTo(map);


// 5. SAVE AND LOAD DATA
// ==========================================

function saveMapData() {
  localStorage.setItem(
    ROUTE_STORAGE_KEY,
    JSON.stringify(routeCoordinates)
  );

  localStorage.setItem(
    PINS_STORAGE_KEY,
    JSON.stringify(pins)
  );
}


function loadMapData() {
  const savedRoute = localStorage.getItem(ROUTE_STORAGE_KEY);
  const savedPins = localStorage.getItem(PINS_STORAGE_KEY);

  if (savedRoute) {
    try {
      routeCoordinates = JSON.parse(savedRoute);
    } catch (error) {
      console.error("Could not load saved route:", error);
      routeCoordinates = [];
    }
  }

  if (savedPins) {
    try {
      pins = JSON.parse(savedPins);
    } catch (error) {
      console.error("Could not load saved pins:", error);
      pins = [];
    }
  }

  drawRoute();
  drawPins();
  updateFogLayer();
}


// 6. DRAW THE ROUTE
// ==========================================

function drawRoute() {
  routeLayer.clearLayers();

  if (routeCoordinates.length < 2) {
    return;
  }

  L.polyline(routeCoordinates, {
    color: "#BD765F",
    weight: 2.5,
    opacity: 0.85,
    lineCap: "round",
    lineJoin: "round",
    pane: "memoryPane"
  }).addTo(routeLayer);
}


// 7. DRAW PINS
// ==========================================

function drawPins() {
  pinLayer.clearLayers();

  pins.forEach((pin) => {
    L.circleMarker([pin.lat, pin.lng], {
      radius: 7,
      color: "#FFFFFF",
      weight: 2,
      fillColor: "#D5AD68",
      fillOpacity: 1,
      pane: "memoryPane"
    }).addTo(pinLayer);
  });
}


// 8. FOG OF WAR
// ==========================================

// This creates a large fog polygon around the visible map.
// Areas around your recorded route are cut out of the fog.
// No SVG texture or filter is used here.

function updateFogLayer() {
  fogLayer.clearLayers();

  if (typeof turf === "undefined") {
    console.error("Turf.js has not loaded.");
    return;
  }

  const bounds = map.getBounds().pad(1);

  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  const outerFog = turf.polygon([[
    [southWest.lng, southWest.lat],
    [northEast.lng, southWest.lat],
    [northEast.lng, northEast.lat],
    [southWest.lng, northEast.lat],
    [southWest.lng, southWest.lat]
  ]]);

  // If there is no recorded route,
  // simply display the full fog polygon.

  if (routeCoordinates.length < 2) {
    fogLayer.addData(outerFog);
    return;
  }

  // Turf expects coordinates in [longitude, latitude] order.

  const routeForTurf = turf.lineString(
    routeCoordinates.map((point) => [
      point[1],
      point[0]
    ])
  );

  // Create a 65 metre buffer around the route.

  const revealedArea = turf.buffer(
    routeForTurf,
    65,
    {
      units: "meters"
    }
  );

  // Cut the revealed area out of the fog.

  try {
    const remainingFog = turf.difference(
      turf.featureCollection([
        outerFog,
        revealedArea
      ])
    );

    if (remainingFog) {
      fogLayer.addData(remainingFog);
    }

  } catch (error) {
    console.error("Could not update fog:", error);

    // If the difference calculation fails,
    // show the original fog instead.

    fogLayer.addData(outerFog);
  }
}


// Update the fog when the map moves or zooms.

map.on("moveend zoomend", updateFogLayer);


// 9. ADD PINS
// ==========================================

const addPinButton = document.getElementById("addPinButton");

if (addPinButton) {
  addPinButton.addEventListener("click", () => {
    addingPin = !addingPin;

    addPinButton.classList.toggle("active", addingPin);

    if (addingPin) {
      addPinButton.textContent = "Click map to add pin";
    } else {
      addPinButton.textContent = "+";
    }
  });
}


map.on("click", (event) => {
  if (!addingPin) {
    return;
  }

  const newPin = {
    lat: event.latlng.lat,
    lng: event.latlng.lng
  };

  pins.push(newPin);

  saveMapData();
  drawPins();

  addingPin = false;

  if (addPinButton) {
    addPinButton.classList.remove("active");
    addPinButton.textContent = "+";
  }
});


// 10. GPS TRACKING
// ==========================================

const trackingButton = document.getElementById("trackingButton");
const trackingStatus = document.getElementById("trackingStatus");


function updateTrackingStatus(message) {
  if (trackingStatus) {
    trackingStatus.textContent = message;
  }
}


function startTracking() {
  if (!navigator.geolocation) {
    updateTrackingStatus("GPS not supported");
    return;
  }

  tracking = true;

  if (trackingButton) {
    trackingButton.textContent = "Stop tracking";
    trackingButton.classList.add("active");
  }

  updateTrackingStatus("Waiting for GPS...");

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      // Ignore very inaccurate GPS readings.

      if (accuracy > 1000) {
        updateTrackingStatus("GPS signal inaccurate");
        return;
      }

      const newPosition = [latitude, longitude];

      // Update the current location marker.

      if (currentPositionMarker) {
        currentPositionMarker.setLatLng(newPosition);
      } else {
        currentPositionMarker = L.circleMarker(newPosition, {
          radius: 8,
          color: "#FFFFFF",
          weight: 3,
          fillColor: "#718F82",
          fillOpacity: 1,
          pane: "memoryPane"
        }).addTo(map);
      }

      // Only record movement when it is at least 5 metres.

      if (routeCoordinates.length > 0) {
        const lastPosition =
          routeCoordinates[routeCoordinates.length - 1];

        const distance = map.distance(
          lastPosition,
          newPosition
        );

        if (distance < 5) {
          return;
        }
      }

      // Add the new position to the route.

      routeCoordinates.push(newPosition);

      drawRoute();
      updateFogLayer();
      saveMapData();

      map.setView(newPosition, 16);

      updateTrackingStatus("Tracking your movement");
    },

    (error) => {
      console.error("GPS error:", error);

      updateTrackingStatus("GPS error: " + error.message);

      stopTracking();
    },

    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    }
  );
}


function stopTracking() {
  tracking = false;

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (trackingButton) {
    trackingButton.textContent = "Start tracking";
    trackingButton.classList.remove("active");
  }

  updateTrackingStatus("Tracking stopped");
}


if (trackingButton) {
  trackingButton.addEventListener("click", () => {
    if (tracking) {
      stopTracking();
    } else {
      startTracking();
    }
  });
}


// 11. EXPORT MAP DATA
// ==========================================

function exportMapData() {
  const data = {
    route: routeCoordinates,
    pins: pins
  };

  const file = new Blob(
    [JSON.stringify(data, null, 2)],
    {
      type: "application/json"
    }
  );

  const url = URL.createObjectURL(file);

  const link = document.createElement("a");

  link.href = url;
  link.download = "invisible-map-data.json";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}


const exportButton = document.getElementById("exportButton");

if (exportButton) {
  exportButton.addEventListener("click", exportMapData);
}


// 12. IMPORT MAP DATA
// ==========================================

const importButton = document.getElementById("importButton");
const importFile = document.getElementById("importFile");


if (importButton && importFile) {
  importButton.addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = (loadEvent) => {
      try {
        const importedData = JSON.parse(loadEvent.target.result);

        if (
          !Array.isArray(importedData.route) ||
          !Array.isArray(importedData.pins)
        ) {
          throw new Error("Invalid map data");
        }

        const confirmed = confirm(
          "Importing this file will replace the map data currently saved on this device. Continue?"
        );

        if (!confirmed) {
          return;
        }

        routeCoordinates = importedData.route;
        pins = importedData.pins;

        saveMapData();

        drawRoute();
        drawPins();
        updateFogLayer();

        alert("Map data imported successfully!");

      } catch (error) {
        console.error("Import error:", error);
        alert("Could not import this file. Please check that it is a valid map backup.");
      }

      importFile.value = "";
    };

    reader.readAsText(file);
  });
}


// 13. INITIALISE
// ==========================================

loadMapData();

console.log("The Invisible Map is ready!");
