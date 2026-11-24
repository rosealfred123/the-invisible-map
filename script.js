
/* ==========================================
   THE INVISIBLE MAP
   Main JavaScript
========================================== */


/* ------------------------------------------
   1. MAP SETUP
------------------------------------------ */

// Replace with your new restricted MapTiler key.
const maptilerKey = "2E4wY5kv31hlD5duk20H";

const map = L.map("map", {
  zoomControl: false
}).setView([51.5074, -0.1278], 13);


// Monochrome map tiles.
L.tileLayer(
  `https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=${maptilerKey}`,
  {
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,
    attribution:
      '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors'
  }
).addTo(map);


// Zoom controls at the top right.
L.control.zoom({
  position: "topright"
}).addTo(map);


/* ------------------------------------------
   2. MAP PANES
------------------------------------------ */

map.createPane("fogPane");
map.getPane("fogPane").style.zIndex = 450;

map.createPane("memoryPane");
map.getPane("memoryPane").style.zIndex = 460;


/* ------------------------------------------
   3. DATA
------------------------------------------ */

let routeSegments = [];
let activeRouteSegment = null;

let pins = [];

let tracking = false;
let watchId = null;
let addingPin = false;

let currentPositionMarker = null;

const ROUTE_STORAGE_KEY = "invisibleMapRouteSegments";
const OLD_ROUTE_STORAGE_KEY = "invisibleMapRoute";
const PINS_STORAGE_KEY = "invisibleMapPins";


/* ------------------------------------------
   4. LAYERS
------------------------------------------ */

const routeLayer = L.layerGroup({
  pane: "memoryPane"
}).addTo(map);

const pinLayer = L.layerGroup({
  pane: "memoryPane"
}).addTo(map);

const fogLayer = L.geoJSON(null, {
  pane: "fogPane",
  style: {
    fillColor: "#FFFFFF",
    fillOpacity: 0.88,
    color: "#FFFFFF",
    opacity: 0,
    weight: 0,
    fillRule: "evenodd"
  }
}).addTo(map);


/* ------------------------------------------
   5. SAVE AND LOAD DATA
------------------------------------------ */

function saveMapData() {

  localStorage.setItem(
    ROUTE_STORAGE_KEY,
    JSON.stringify(routeSegments)
  );

  localStorage.setItem(
    PINS_STORAGE_KEY,
    JSON.stringify(pins)
  );

}


function loadMapData() {

  const savedRouteSegments =
    localStorage.getItem(ROUTE_STORAGE_KEY);

  const savedPins =
    localStorage.getItem(PINS_STORAGE_KEY);


  // Load segmented route format.

  if (savedRouteSegments) {

    try {

      const parsed = JSON.parse(savedRouteSegments);

      if (Array.isArray(parsed)) {
        routeSegments = parsed;
      }

    } catch (error) {

      console.error("Could not load route segments:", error);
      routeSegments = [];

    }

  } else {

    // Support older route format.

    const oldRoute =
      localStorage.getItem(OLD_ROUTE_STORAGE_KEY);

    if (oldRoute) {

      try {

        const parsedOldRoute = JSON.parse(oldRoute);

        if (
          Array.isArray(parsedOldRoute) &&
          parsedOldRoute.length > 0
        ) {
          routeSegments = [parsedOldRoute];
        }

      } catch (error) {

        console.error("Could not load old route:", error);
        routeSegments = [];

      }

    }

  }


  // Load pins.

  if (savedPins) {

    try {

      const parsedPins = JSON.parse(savedPins);

      if (Array.isArray(parsedPins)) {
        pins = parsedPins.filter(pin =>
          pin &&
          Number.isFinite(Number(pin.lat)) &&
          Number.isFinite(Number(pin.lng))
        );
      }

    } catch (error) {

      console.error("Could not load saved pins:", error);
      pins = [];

    }

  }


  routeSegments = routeSegments.filter(
    segment => Array.isArray(segment)
  );

  drawRoute();
  drawPins();
  updateFogLayer();

  saveMapData();

}


/* ------------------------------------------
   6. DRAW THE ROUTES
------------------------------------------ */

// Create evenly spaced samples from each route.

function getRouteSamples(segment, spacing = 15) {

  if (segment.length < 2 || typeof turf === "undefined") {
    return segment;
  }

  const line = turf.lineString(
    segment.map(point => [point[1], point[0]])
  );

  const length = turf.length(line, {
    units: "meters"
  });

  const samples = [];

  for (
    let distance = 0;
    distance <= length;
    distance += spacing
  ) {

    const point = turf.along(
      line,
      distance,
      { units: "meters" }
    );

    samples.push([
      point.geometry.coordinates[1],
      point.geometry.coordinates[0]
    ]);

  }


  // Always include the final GPS point.

  const lastPoint = segment[segment.length - 1];

  if (
    samples.length === 0 ||
    map.distance(
      samples[samples.length - 1],
      lastPoint
    ) > 2
  ) {
    samples.push(lastPoint);
  }

  return samples;

}


// Count how many different sessions passed nearby.

function countNearbyVisits(
  point,
  currentSegmentIndex,
  sampledSegments
) {

  let visitCount = 1;

  sampledSegments.forEach(
    (otherSamples, otherSegmentIndex) => {

      if (otherSegmentIndex === currentSegmentIndex) {
        return;
      }

      const hasNearbyPoint = otherSamples.some(otherPoint => {

        return map.distance(point, otherPoint) <= 25;

      });

      if (hasNearbyPoint) {
        visitCount++;
      }

    }
  );

  return visitCount;

}


// More frequently visited paths become darker.

function getRouteStyle(visitCount) {

  if (visitCount === 1) {

    return {
      color: "#888888",
      weight: 2,
      opacity: 0.58
    };

  }

  if (visitCount === 2) {

    return {
      color: "#555555",
      weight: 2.7,
      opacity: 0.78
    };

  }

  if (visitCount === 3) {

    return {
      color: "#333333",
      weight: 3.3,
      opacity: 0.9
    };

  }

  return {
    color: "#111111",
    weight: 4,
    opacity: 1
  };

}


function drawRoute() {

  routeLayer.clearLayers();

  const sampledSegments = routeSegments.map(segment => {
    return getRouteSamples(segment);
  });


  routeSegments.forEach((segment, segmentIndex) => {

    if (segment.length < 2) {
      return;
    }

    const samples = sampledSegments[segmentIndex];

    if (samples.length < 2) {
      return;
    }

    let currentVisitCount = null;
    let currentLine = [];


    function addCurrentLine() {

      if (
        currentLine.length < 2 ||
        currentVisitCount === null
      ) {
        return;
      }

      const style = getRouteStyle(currentVisitCount);


      // Layer 1: Wide ink halo.

      L.polyline(currentLine, {
        color: style.color,
        weight: style.weight * 4,
        opacity: style.opacity * 0.09,
        lineCap: "round",
        lineJoin: "round",
        pane: "memoryPane"
      }).addTo(routeLayer);


      // Layer 2: Middle pigment.

      L.polyline(currentLine, {
        color: style.color,
        weight: style.weight * 2,
        opacity: style.opacity * 0.2,
        lineCap: "round",
        lineJoin: "round",
        pane: "memoryPane"
      }).addTo(routeLayer);


      // Layer 3: Central ink line.

      L.polyline(currentLine, {
        color: style.color,
        weight: style.weight,
        opacity: style.opacity,
        lineCap: "round",
        lineJoin: "round",
        pane: "memoryPane"
      }).addTo(routeLayer);

    }


    samples.forEach(point => {

      const visitCount = countNearbyVisits(
        point,
        segmentIndex,
        sampledSegments
      );

      if (currentVisitCount === null) {

        currentVisitCount = visitCount;
        currentLine = [point];

      } else if (visitCount === currentVisitCount) {

        currentLine.push(point);

      } else {

        currentLine.push(point);

        addCurrentLine();

        currentVisitCount = visitCount;
        currentLine = [point];

      }

    });

    addCurrentLine();

  });

}


/* ------------------------------------------
   7. DRAW PINS
------------------------------------------ */

function drawPins() {

  pinLayer.clearLayers();

  pins.forEach((pin, index) => {

    const marker = L.circleMarker(
      [Number(pin.lat), Number(pin.lng)],
      {
        radius: 7,
        color: "#FFFFFF",
        weight: 2,
        fillColor: "#B83232",
        fillOpacity: 1,
        pane: "memoryPane"
      }
    ).addTo(pinLayer);


    // Clicking a pin opens its editor.

    marker.on("click", () => {
      openPinEditor(index);
    });

  });

}


/* ------------------------------------------
   8. FOG OF WAR + ORGANIC EDGES
------------------------------------------ */

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


  const organicShapes = [];


  // Repeatable random-looking values.

  function seededVariation(index) {

    const value =
      Math.sin(index * 127.1 + 19.7) * 43758.5453;

    return value - Math.floor(value);

  }


  // Process every route segment.

  routeSegments.forEach((segment, segmentIndex) => {

    if (segment.length < 2) {
      return;
    }

    const routeForTurf = turf.lineString(
      segment.map(point => [
        point[1],
        point[0]
      ])
    );

    const routeLength = turf.length(
      routeForTurf,
      { units: "meters" }
    );


    // Original 65 metre corridor.

    const revealedArea = turf.buffer(
      routeForTurf,
      65,
      {
        units: "meters"
      }
    );

    organicShapes.push(revealedArea);


    // Organic edge experiment.

    const spacing = 150;

    const sampleCount = Math.min(
      60,
      Math.floor(routeLength / spacing)
    );


    for (let i = 1; i <= sampleCount; i++) {

      const distanceAlongRoute =
        (routeLength * i) / (sampleCount + 1);

      const point = turf.along(
        routeForTurf,
        distanceAlongRoute,
        { units: "meters" }
      );

      const before = turf.along(
        routeForTurf,
        Math.max(0, distanceAlongRoute - 10),
        { units: "meters" }
      );

      const after = turf.along(
        routeForTurf,
        Math.min(routeLength, distanceAlongRoute + 10),
        { units: "meters" }
      );

      const direction = turf.bearing(before, after);

      const side = i % 2 === 0 ? 90 : -90;

      const variationIndex =
        segmentIndex * 10000 + i;

      const offset =
        25 + seededVariation(variationIndex) * 30;

      const radius =
        24 + seededVariation(variationIndex + 1000) * 22;

      const bumpCenter = turf.destination(
        point,
        offset,
        direction + side,
        { units: "meters" }
      );

      const bump = turf.circle(
        bumpCenter,
        radius,
        {
          units: "meters",
          steps: 12
        }
      );

      organicShapes.push(bump);

    }

  });


  // No routes: display full fog.

  if (organicShapes.length === 0) {

    fogLayer.addData(outerFog);
    return;

  }


  // Merge all revealed areas.

  let finalReveal;

  try {

    finalReveal = turf.union(
      turf.featureCollection(organicShapes)
    );

  } catch (error) {

    console.warn(
      "Could not merge organic shapes:",
      error
    );


    // Fallback: use basic route buffers.

    const basicBuffers = [];

    routeSegments.forEach(segment => {

      if (segment.length < 2) {
        return;
      }

      const line = turf.lineString(
        segment.map(point => [
          point[1],
          point[0]
        ])
      );

      basicBuffers.push(
        turf.buffer(line, 65, {
          units: "meters"
        })
      );

    });


    try {

      finalReveal = turf.union(
        turf.featureCollection(basicBuffers)
      );

    } catch (fallbackError) {

      console.error(
        "Could not create reveal area:",
        fallbackError
      );

      fogLayer.addData(outerFog);
      return;

    }

  }


  // Cut revealed areas out of the fog.

  try {

    const remainingFog = turf.difference(
      turf.featureCollection([
        outerFog,
        finalReveal
      ])
    );

    if (remainingFog) {
      fogLayer.addData(remainingFog);
    }

  } catch (error) {

    console.error("Could not update fog:", error);

    fogLayer.addData(outerFog);

  }

}


// Update fog when map moves or zooms.

map.on("moveend zoomend", updateFogLayer);


/* ------------------------------------------
   9. ADD, EDIT AND DELETE PINS
------------------------------------------ */

const addPinButton =
  document.getElementById("addPinButton");

const pinModal =
  document.getElementById("pinModal");

const pinForm =
  document.getElementById("pinForm");

const pinModalTitle =
  document.getElementById("pinModalTitle");

const pinTitle =
  document.getElementById("pinTitle");

const pinNote =
  document.getElementById("pinNote");

const pinFeeling =
  document.getElementById("pinFeeling");

const pinLocationStatus =
  document.getElementById("pinLocationStatus");

const choosePinLocation =
  document.getElementById("choosePinLocation");

const savePinButton =
  document.getElementById("savePinButton");

const deletePinButton =
  document.getElementById("deletePinButton");

const cancelPinButton =
  document.getElementById("cancelPinButton");

const closePinModal =
  document.getElementById("closePinModal");


let pendingPinLocation = null;
let editingPinIndex = null;


// Open the editor.

function openPinEditor(index = null) {

  editingPinIndex = index;

  addingPin = false;


  if (index !== null) {

    const pin = pins[index];

    pinModalTitle.textContent = "Edit memory";

    pinTitle.value = pin.title || "";
    pinNote.value = pin.note || "";
    pinFeeling.value = pin.feeling || "";

    pendingPinLocation = {
      lat: Number(pin.lat),
      lng: Number(pin.lng)
    };

    deletePinButton.hidden = false;

    pinLocationStatus.textContent =
      "Location selected";

  } else {

    pinModalTitle.textContent = "New memory";

    pinTitle.value = "";
    pinNote.value = "";
    pinFeeling.value = "";

    pendingPinLocation = null;

    deletePinButton.hidden = true;

    pinLocationStatus.textContent =
      "No location selected yet";

  }


  updatePinSaveButton();

  pinModal.classList.remove("is-hidden");

}


// Enable save only after a location is selected.

function updatePinSaveButton() {

  savePinButton.disabled =
    pendingPinLocation === null;

}


// Close the editor.

function closePinEditor() {

  pinModal.classList.add("is-hidden");

  addingPin = false;

  if (addPinButton) {

    addPinButton.classList.remove("active");
    addPinButton.textContent = "+";

  }

}


// Add button opens a new memory.

if (addPinButton) {

  addPinButton.addEventListener("click", () => {

    openPinEditor();

  });

}


// Choose a location on the map.

choosePinLocation.addEventListener("click", () => {

  addingPin = true;

  pinModal.classList.add("is-hidden");

  updateTrackingStatus(
    "Click the map to choose a location"
  );

});


// Map click selects a location when choosing a pin.

map.on("click", event => {

  if (!addingPin) {
    return;
  }

  pendingPinLocation = {
    lat: event.latlng.lat,
    lng: event.latlng.lng
  };

  addingPin = false;

  pinLocationStatus.textContent =
    "Location selected";

  updatePinSaveButton();

  pinModal.classList.remove("is-hidden");

  updateTrackingStatus("Location selected");

});


// Save a new pin or update an existing one.

pinForm.addEventListener("submit", event => {

  event.preventDefault();

  if (!pendingPinLocation) {
    return;
  }


  const updatedPin = {

    lat: pendingPinLocation.lat,
    lng: pendingPinLocation.lng,

    title: pinTitle.value.trim(),
    note: pinNote.value.trim(),
    feeling: pinFeeling.value.trim(),

    date: editingPinIndex !== null
      ? pins[editingPinIndex].date || new Date().toISOString()
      : new Date().toISOString()

  };


  if (editingPinIndex !== null) {

    pins[editingPinIndex] = updatedPin;

  } else {

    pins.push(updatedPin);

  }


  saveMapData();

  drawPins();

  closePinEditor();

  updateTrackingStatus("Memory saved");

});


// Delete an existing pin.

deletePinButton.addEventListener("click", () => {

  if (editingPinIndex === null) {
    return;
  }

  const confirmed = confirm(
    "Are you sure you want to delete this memory?"
  );

  if (!confirmed) {
    return;
  }

  pins.splice(editingPinIndex, 1);

  saveMapData();

  drawPins();

  closePinEditor();

  updateTrackingStatus("Memory deleted");

});


// Cancel or close the editor.

cancelPinButton.addEventListener(
  "click",
  closePinEditor
);

closePinModal.addEventListener(
  "click",
  closePinEditor
);


// Close when clicking the dark background.

pinModal.addEventListener("click", event => {

  if (event.target === pinModal) {
    closePinEditor();
  }

});


// Close with Escape.

document.addEventListener("keydown", event => {

  if (
    event.key === "Escape" &&
    !pinModal.classList.contains("is-hidden")
  ) {
    closePinEditor();
  }

});


/* ------------------------------------------
   10. CURRENT LOCATION
------------------------------------------ */

const locationButton =
  document.getElementById("locationButton");


function updateCurrentPositionMarker(position) {

  const newPosition = [
    position.coords.latitude,
    position.coords.longitude
  ];


  if (currentPositionMarker) {

    currentPositionMarker.setLatLng(newPosition);

  } else {

    currentPositionMarker = L.circleMarker(
      newPosition,
      {
        radius: 8,
        color: "#FFFFFF",
        weight: 3,
        fillColor: "#111111",
        fillOpacity: 1,
        pane: "memoryPane"
      }
    ).addTo(map);

  }

  return newPosition;

}


// Center map on current location.

function centerOnCurrentLocation() {

  if (!navigator.geolocation) {

    updateTrackingStatus("GPS not supported");
    return;

  }

  updateTrackingStatus("Finding your location...");


  navigator.geolocation.getCurrentPosition(

    position => {

      if (position.coords.accuracy > 1000) {

        updateTrackingStatus("GPS signal inaccurate");
        return;

      }

      const newPosition =
        updateCurrentPositionMarker(position);

      map.setView(newPosition, 16);

      updateTrackingStatus("Showing your location");

    },


    error => {

      console.error("Location error:", error);

      updateTrackingStatus(
        "Could not find location: " + error.message
      );

    },


    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000
    }

  );

}


if (locationButton) {

  locationButton.addEventListener(
    "click",
    centerOnCurrentLocation
  );

}


/* ------------------------------------------
   11. GPS TRACKING
------------------------------------------ */

const trackingButton =
  document.getElementById("trackingButton");

const trackingStatus =
  document.getElementById("trackingStatus");


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

  if (tracking) {
    return;
  }

  tracking = true;


  // Create a new segment for this session.

  activeRouteSegment = [];

  routeSegments.push(activeRouteSegment);

  saveMapData();


  if (trackingButton) {

    trackingButton.textContent = "Stop tracking";
    trackingButton.classList.add("active");

  }

  updateTrackingStatus("Waiting for GPS...");


  watchId = navigator.geolocation.watchPosition(

    position => {

      const accuracy = position.coords.accuracy;


      // Ignore inaccurate GPS readings.

      if (accuracy > 1000) {

        updateTrackingStatus("GPS signal inaccurate");
        return;

      }


      // Update location marker without moving the map.

      const newPosition =
        updateCurrentPositionMarker(position);


      // Compare with the last point in this session.

      if (activeRouteSegment.length > 0) {

        const lastPosition =
          activeRouteSegment[
            activeRouteSegment.length - 1
          ];

        const distance = map.distance(
          lastPosition,
          newPosition
        );

        if (distance < 5) {
          return;
        }

      }


      // Add new GPS point.

      activeRouteSegment.push(newPosition);

      drawRoute();
      updateFogLayer();
      saveMapData();

      updateTrackingStatus("Tracking your movement");

    },


    error => {

      console.error("GPS error:", error);

      updateTrackingStatus(
        "GPS error: " + error.message
      );

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


  // Remove an empty session.

  if (
    activeRouteSegment &&
    activeRouteSegment.length === 0
  ) {

    const index =
      routeSegments.indexOf(activeRouteSegment);

    if (index !== -1) {
      routeSegments.splice(index, 1);
    }

  }


  activeRouteSegment = null;

  saveMapData();

  drawRoute();
  updateFogLayer();


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


/* ------------------------------------------
   12. EXPORT MAP DATA
------------------------------------------ */

function exportMapData() {

  const data = {
    routeSegments: routeSegments,
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


const exportButton =
  document.getElementById("exportButton");

if (exportButton) {

  exportButton.addEventListener(
    "click",
    exportMapData
  );

}


/* ------------------------------------------
   13. IMPORT MAP DATA
------------------------------------------ */

const importButton =
  document.getElementById("importButton");

const importFile =
  document.getElementById("importFile");


if (importButton && importFile) {

  importButton.addEventListener("click", () => {
    importFile.click();
  });


  importFile.addEventListener("change", event => {

    const file = event.target.files[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();


    reader.onload = loadEvent => {

      try {

        const importedData = JSON.parse(
          loadEvent.target.result
        );


        // Support current and older route formats.

        let importedSegments;

        if (Array.isArray(importedData.routeSegments)) {

          importedSegments =
            importedData.routeSegments;

        } else if (Array.isArray(importedData.route)) {

          importedSegments =
            importedData.route.length > 0
              ? [importedData.route]
              : [];

        } else {

          throw new Error("Invalid route data");

        }


        if (!Array.isArray(importedData.pins)) {
          throw new Error("Invalid pin data");
        }


        const confirmed = confirm(
          "Importing this file will replace the map data currently saved on this device. Continue?"
        );

        if (!confirmed) {
          return;
        }


        // Stop tracking before replacing data.

        if (tracking) {
          stopTracking();
        }

        activeRouteSegment = null;


        routeSegments = importedSegments.filter(
          segment => Array.isArray(segment)
        );


        pins = importedData.pins.filter(pin =>
          pin &&
          Number.isFinite(Number(pin.lat)) &&
          Number.isFinite(Number(pin.lng))
        );


        saveMapData();

        drawRoute();
        drawPins();
        updateFogLayer();

        alert("Map data imported successfully!");

      } catch (error) {

        console.error("Import error:", error);

        alert(
          "Could not import this file. Please check that it is a valid map backup."
        );

      }


      importFile.value = "";

    };


    reader.readAsText(file);

  });

}


/* ------------------------------------------
   14. INITIALISE
------------------------------------------ */

loadMapData();

console.log("The Invisible Map is ready!");
