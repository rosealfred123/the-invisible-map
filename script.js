
// ------------------------------------
// 1. MAP SETUP
// ------------------------------------

const maptilerKey = "2E4wY5kv31hlD5duk20H";

// Center map on London
const map = L.map("map").setView(
  [51.5072, -0.1276],
  13
);

// Load MapTiler map
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
// 2. ADD PIN FUNCTIONALITY
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

map.on("click", (event) => {

  if (!addingPin) return;

  L.marker(event.latlng).addTo(map);

  addingPin = false;
  addPinButton.textContent = "+";
  addPinButton.title = "Add a pin";

});


// ------------------------------------
// 3. GPS TRACKING SETUP
// ------------------------------------

const trackingButton = document.getElementById("trackingButton");
const trackingStatus = document.getElementById("trackingStatus");

let tracking = false;
let watchId = null;
let currentLocationMarker = null;

// Load saved coordinates
let routeCoordinates = JSON.parse(
  localStorage.getItem("invisibleMapRoute") || "[]"
);


// ------------------------------------
// 4. MAP VISUAL LAYERS
// ------------------------------------

// Create map panes
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

// Restore saved memory circles
routeCoordinates.forEach((position) => {

  L.circle(position, {
    radius: 20,
    stroke: false,
    fillColor: "#222222",
    fillOpacity: 0.08,
    pane: "memoryPane"
  }).addTo(memoryLayer);

});


// Restore saved route position
if (routeCoordinates.length > 0) {

  map.fitBounds(routeLine.getBounds(), {
    padding: [30, 30]
  });

}


// ------------------------------------
// 5. FOG / REVEAL EFFECT
// ------------------------------------

let fogLayer = null;


// Create a circular area around a GPS position
function createCircleRing(center, radius, steps = 32) {

  const earthRadius = 6378137;

  const lat = center[0] * Math.PI / 180;
  const lng = center[1] * Math.PI / 180;

  const angularDistance = radius / earthRadius;

  const points = [];

  for (let i = 0; i < steps; i++) {

    const bearing = 2 * Math.PI * i / steps;

    const newLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) +
      Math.cos(lat) * Math.sin(angularDistance) *
      Math.cos(bearing)
    );

    const newLng = lng + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) *
      Math.cos(lat),
      Math.cos(angularDistance) -
      Math.sin(lat) * Math.sin(newLat)
    );

    points.push([
      newLat * 180 / Math.PI,
      newLng * 180 / Math.PI
    ]);

  }

  return points;

}



function updateFogLayer() {

  // Remove the previous fog
  if (fogLayer !== null) {
    map.removeLayer(fogLayer);
  }

  const bounds = map.getBounds().pad(0.5);

  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  // Outer fog boundary
  const outerRing = [
    [southWest.lat, southWest.lng],
    [southWest.lat, northEast.lng],
    [northEast.lat, northEast.lng],
    [northEast.lat, southWest.lng],
    [southWest.lat, southWest.lng]
  ];

  const holes = [];

  // Create a continuous revealed area around the route
  if (routeCoordinates.length > 0) {

    let routeFeature;

    if (routeCoordinates.length === 1) {

      // If there is only one GPS point, create a circle
      const position = routeCoordinates[0];

      routeFeature = turf.point([
        position[1],
        position[0]
      ]);

    } else {

      // Convert GPS coordinates into Turf's format
      const coordinates = routeCoordinates.map(position => [
        position[1],
        position[0]
      ]);

      routeFeature = turf.lineString(coordinates);

    }

    // Expand the route by 65 metres
    const revealedArea = turf.buffer(
      routeFeature,
      65,
      { units: "meters" }
    );

    // Get the polygon boundaries
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

  // Draw the fog with the continuous revealed area
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



// Draw fog initially
updateFogLayer();

// Update fog when the map moves or zooms
map.on("moveend zoomend", updateFogLayer);


// ------------------------------------
// 6. START GPS TRACKING
// ------------------------------------

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

    (position) => {

      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      // Ignore very inaccurate locations
      if (accuracy > 1000) {

        trackingStatus.textContent =
          "Location accuracy too low: " +
          Math.round(accuracy) + " metres";

        return;

      }

      const newPosition = [latitude, longitude];

      // Move map to current location
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

      // Update route line
      routeLine.setLatLngs(routeCoordinates);


      // Add memory circle
      L.circle(newPosition, {
        radius: 20,
        stroke: false,
        fillColor: "#222222",
        fillOpacity: 0.08,
        pane: "memoryPane"
      }).addTo(memoryLayer);


      // Update fog
      updateFogLayer();


      // Save coordinates
      localStorage.setItem(
        "invisibleMapRoute",
        JSON.stringify(routeCoordinates)
      );

      trackingStatus.textContent = "GPS tracking active";

    },


    // GPS errors
    (error) => {

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


    // GPS settings
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
