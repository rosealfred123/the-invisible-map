
/* ==========================================
   THE INVISIBLE MAP
   Main JavaScript
========================================== */


/* ------------------------------------------
   1. MAP SETUP
------------------------------------------ */

// Insert your NEW restricted MapTiler key here.
const maptilerKey = "2E4wY5kv31hlD5duk20H";

const map = L.map("map", {
  zoomControl: false,

  // Render Leaflet paths using Canvas instead of SVG.
  // This helps when the map contains many route lines.
  preferCanvas: true
}).setView([51.5074, -0.1278], 13);


// Monochrome map tiles.
L.tileLayer(
  `https://api.maptiler.com/maps/toner-v2/{z}/{x}/{y}.png?key=${maptilerKey}`,
  {
    tileSize: 512,
    zoomOffset: -1,
    minZoom: 1,

    // Improve tile loading behaviour during zooming.
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 2,

    attribution:
      '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors'
  }
).addTo(map);


// Zoom controls.
L.control.zoom({
  position: "topright"
}).addTo(map);


/* ------------------------------------------
   2. MAP PANES
------------------------------------------ */

map.createPane("fogPane");
map.getPane("fogPane").style.zIndex = 450;

map.createPane("contourPane");
map.getPane("contourPane").style.zIndex = 455;

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


// Canvas used for the cloudy fog.
const fogCanvas = document.createElement("canvas");

fogCanvas.style.position = "absolute";
fogCanvas.style.top = "0";
fogCanvas.style.left = "0";
fogCanvas.style.pointerEvents = "none";

// Hint to the browser that this canvas will be transformed.
fogCanvas.style.willChange = "transform";

const fogContext = fogCanvas.getContext("2d", {
  alpha: true
});

map.getPane("fogPane").appendChild(fogCanvas);


// Contour lines.
const contourLayer = L.layerGroup({
  pane: "contourPane"
}).addTo(map);


/* ------------------------------------------
   5. CONTOUR LINES
------------------------------------------ */

function drawContourLines() {

  contourLayer.clearLayers();

  if (
    typeof turf === "undefined" ||
    routeSegments.length === 0
  ) {
    return;
  }

  const contourLevels = [
    {
      distance: 18,
      color: "#B0B0B0",
      opacity: 0.9,
      weight: 1.0
    },
    {
      distance: 28,
      color: "#999999",
      opacity: 0.8,
      weight: 1.0
    },
    {
      distance: 40,
      color: "#858585",
      opacity: 0.7,
      weight: 1.0
    }
  ];

  contourLevels.forEach(level => {

    const buffers = [];

    routeSegments.forEach(segment => {

      if (!Array.isArray(segment) || segment.length < 2) {
        return;
      }

      try {

        const routeLine = turf.lineString(
          segment.map(point => [point[1], point[0]])
        );

        const buffer = turf.buffer(
          routeLine,
          level.distance,
          {
            units: "meters",
            steps: 24
          }
        );

        if (buffer) {
          buffers.push(buffer);
        }

      } catch (error) {
        console.warn("Could not create a contour buffer:", error);
      }

    });

    if (buffers.length === 0) {
      return;
    }

    let mergedContours;

    try {

      if (buffers.length === 1) {
        mergedContours = buffers[0];
      } else {
        mergedContours = turf.union(
          turf.featureCollection(buffers)
        );
      }

    } catch (error) {

      console.warn("Could not merge contour lines:", error);
      mergedContours = null;

    }

    const contourStyle = {
      pane: "contourPane",
      style: {
        color: level.color,
        opacity: level.opacity,
        weight: level.weight,
        fill: false,
        interactive: false,
        lineCap: "round",
        lineJoin: "round"
      },
      interactive: false
    };

    if (mergedContours) {

      L.geoJSON(mergedContours, contourStyle).addTo(contourLayer);

    } else {

      buffers.forEach(buffer => {
        L.geoJSON(buffer, contourStyle).addTo(contourLayer);
      });

    }

  });

}


/* ------------------------------------------
   6. SAVE AND LOAD DATA
------------------------------------------ */

function saveMapData() {

  try {

    localStorage.setItem(
      ROUTE_STORAGE_KEY,
      JSON.stringify(routeSegments)
    );

    localStorage.setItem(
      PINS_STORAGE_KEY,
      JSON.stringify(pins)
    );

  } catch (error) {

    console.error("Could not save map data:", error);

  }

}


function loadMapData() {

  const savedRouteSegments =
    localStorage.getItem(ROUTE_STORAGE_KEY);

  const savedPins =
    localStorage.getItem(PINS_STORAGE_KEY);

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

  // Contours only need to be recalculated when route data changes.
  drawContourLines();

  updateFogLayer();

  saveMapData();

}


/* ------------------------------------------
   7. DRAW THE ROUTES
------------------------------------------ */

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

  const lastPoint = segment[segment.length - 1];

  if (
    samples.length === 0 ||
    map.distance(samples[samples.length - 1], lastPoint) > 2
  ) {
    samples.push(lastPoint);
  }

  return samples;

}


function countNearbyVisits(
  point,
  currentSegmentIndex,
  sampledSegments
) {

  let visitCount = 1;

  sampledSegments.forEach((otherSamples, otherSegmentIndex) => {

    if (otherSegmentIndex === currentSegmentIndex) {
      return;
    }

    const hasNearbyPoint = otherSamples.some(otherPoint => {
      return map.distance(point, otherPoint) <= 25;
    });

    if (hasNearbyPoint) {
      visitCount++;
    }

  });

  return visitCount;

}


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

      // Wide ink halo.
      L.polyline(currentLine, {
        color: style.color,
        weight: style.weight * 4,
        opacity: style.opacity * 0.09,
        lineCap: "round",
        lineJoin: "round",
        pane: "memoryPane"
      }).addTo(routeLayer);

      // Middle pigment.
      L.polyline(currentLine, {
        color: style.color,
        weight: style.weight * 2,
        opacity: style.opacity * 0.2,
        lineCap: "round",
        lineJoin: "round",
        pane: "memoryPane"
      }).addTo(routeLayer);

      // Central ink line.
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
   8. DRAW PINS
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

    marker.on("click", () => {
      openPinEditor(index);
    });

  });

}


/* ------------------------------------------
   9. CLOUD TEXTURE
------------------------------------------ */

// Generate a soft noise texture for the fog.

function createCloudTexture(width, height, scale = 12) {

  const texture = document.createElement("canvas");

  texture.width = Math.max(1, Math.ceil(width / scale));
  texture.height = Math.max(1, Math.ceil(height / scale));

  const context = texture.getContext("2d");

  const imageData = context.createImageData(
    texture.width,
    texture.height
  );

  for (let i = 0; i < imageData.data.length; i += 4) {

    const value = 65 + Math.random() * 190;

    imageData.data[i] = value;
    imageData.data[i + 1] = value;
    imageData.data[i + 2] = value;
    imageData.data[i + 3] = 255;

  }

  context.putImageData(imageData, 0, 0);

  return texture;

}


// Cache cloud textures instead of generating new ones
// every time the map is moved or zoomed.

let cachedLargeClouds = null;
let cachedSmallClouds = null;

let cachedTextureWidth = 0;
let cachedTextureHeight = 0;


function getCloudTextures(width, height) {

  if (
    !cachedLargeClouds ||
    width !== cachedTextureWidth ||
    height !== cachedTextureHeight
  ) {

    cachedTextureWidth = width;
    cachedTextureHeight = height;

    cachedLargeClouds = createCloudTexture(
      width,
      height,
      18
    );

    cachedSmallClouds = createCloudTexture(
      width,
      height,
      7
    );

  }

  return {
    large: cachedLargeClouds,
    small: cachedSmallClouds
  };

}


/* ------------------------------------------
   10. CLOUDY FOG OF WAR
------------------------------------------ */

function updateFogLayer() {

  const size = map.getSize();

  const width = size.x;
  const height = size.y;

  // Limit pixel density to reduce canvas workload.
  // This is still sharp enough for the fog effect.
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    1.5
  );

  const canvasWidth = Math.round(width * pixelRatio);
  const canvasHeight = Math.round(height * pixelRatio);

  // Only resize the canvas when its dimensions change.
  // Changing canvas dimensions clears it and resets its context.
  if (
    fogCanvas.width !== canvasWidth ||
    fogCanvas.height !== canvasHeight
  ) {

    fogCanvas.width = canvasWidth;
    fogCanvas.height = canvasHeight;

  }

  fogCanvas.style.width = width + "px";
  fogCanvas.style.height = height + "px";

  const topLeft = map.containerPointToLayerPoint([0, 0]);

  L.DomUtil.setPosition(fogCanvas, topLeft);

  fogContext.setTransform(
    pixelRatio,
    0,
    0,
    pixelRatio,
    0,
    0
  );

  fogContext.clearRect(0, 0, width, height);

  // ----------------------------------------
  // 1. BASE FOG
  // ----------------------------------------

  fogContext.globalCompositeOperation = "source-over";

  fogContext.fillStyle = "rgba(252, 247, 247, 0.84)";

  fogContext.fillRect(0, 0, width, height);

  // ----------------------------------------
  // 2. CLOUD TEXTURES
  // ----------------------------------------

  const cloudTextures = getCloudTextures(width, height);

  const largeClouds = cloudTextures.large;
  const smallClouds = cloudTextures.small;

  // ----------------------------------------
  // 3. LARGE CLOUD FORMATIONS
  // ----------------------------------------

  fogContext.save();

  fogContext.globalAlpha = 0.7;
  fogContext.filter = "blur(15px)";

  fogContext.drawImage(
    largeClouds,
    0,
    0,
    width,
    height
  );

  fogContext.restore();

  // ----------------------------------------
  // 4. SMALLER CLOUD DETAILS
  // ----------------------------------------

  fogContext.save();

  fogContext.globalAlpha = 0.5;
  fogContext.filter = "blur(15px)";

  fogContext.drawImage(
    smallClouds,
    0,
    0,
    width,
    height
  );

  fogContext.restore();

  // ----------------------------------------
  // 5. REVEAL EXPLORED ROUTES
  // ----------------------------------------

  fogContext.globalCompositeOperation = "destination-out";

  routeSegments.forEach(segment => {

    if (!Array.isArray(segment) || segment.length < 2) {
      return;
    }

    const points = segment.map(point => {

      return map.latLngToContainerPoint([
        point[0],
        point[1]
      ]);

    });

    if (points.length < 2) {
      return;
    }

    const firstPoint = segment[0];

    const nearbyPoint = [
      firstPoint[0] + 12 / 111320,
      firstPoint[1]
    ];

    const startPixel =
      map.latLngToContainerPoint(firstPoint);

    const nearbyPixel =
      map.latLngToContainerPoint(nearbyPoint);

    const revealRadius = Math.max(
      2,
      Math.abs(startPixel.y - nearbyPixel.y)
    );

    function drawRoutePath() {

      fogContext.beginPath();

      points.forEach((point, index) => {

        if (index === 0) {
          fogContext.moveTo(point.x, point.y);
        } else {
          fogContext.lineTo(point.x, point.y);
        }

      });

    }

    // Soft outer edge.
    fogContext.save();

    drawRoutePath();

    fogContext.filter = "blur(8px)";
    fogContext.lineWidth = revealRadius * 2.2;
    fogContext.lineCap = "round";
    fogContext.lineJoin = "round";
    fogContext.strokeStyle = "black";

    fogContext.stroke();

    fogContext.restore();

    // Clearer centre.
    drawRoutePath();

    fogContext.filter = "none";
    fogContext.lineWidth = revealRadius * 1.5;
    fogContext.lineCap = "round";
    fogContext.lineJoin = "round";
    fogContext.strokeStyle = "black";

    fogContext.stroke();

  });

  fogContext.globalCompositeOperation = "source-over";
  fogContext.filter = "none";

}


// ------------------------------------------
// SCHEDULE FOG REDRAWS
// ------------------------------------------

// Leaflet can fire several map events close together.
// This makes sure the fog is only redrawn once per frame.

let fogUpdateScheduled = false;

function scheduleFogUpdate() {

  if (fogUpdateScheduled) {
    return;
  }

  fogUpdateScheduled = true;

  requestAnimationFrame(() => {

    fogUpdateScheduled = false;

    updateFogLayer();

  });

}


// Redraw the fog when the map changes.
map.on("moveend zoomend resize", scheduleFogUpdate);


/* ------------------------------------------
   11. ADD, EDIT AND DELETE PINS
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


function updatePinSaveButton() {

  savePinButton.disabled =
    pendingPinLocation === null;

}


function closePinEditor() {

  pinModal.classList.add("is-hidden");

  addingPin = false;

  if (addPinButton) {
    addPinButton.classList.remove("active");
    addPinButton.textContent = "+";
  }

}


if (addPinButton) {

  addPinButton.addEventListener("click", () => {
    openPinEditor();
  });

}


choosePinLocation.addEventListener("click", () => {

  addingPin = true;

  pinModal.classList.add("is-hidden");

  updateTrackingStatus(
    "Click the map to choose a location"
  );

});


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


cancelPinButton.addEventListener(
  "click",
  closePinEditor
);

closePinModal.addEventListener(
  "click",
  closePinEditor
);


pinModal.addEventListener("click", event => {

  if (event.target === pinModal) {
    closePinEditor();
  }

});


document.addEventListener("keydown", event => {

  if (
    event.key === "Escape" &&
    !pinModal.classList.contains("is-hidden")
  ) {
    closePinEditor();
  }

});


/* ------------------------------------------
   12. CURRENT LOCATION
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
        fillColor: "#228B22",
        fillOpacity: 1,
        pane: "memoryPane"
      }
    ).addTo(map);

  }

  return newPosition;

}


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
   13. GPS TRACKING
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

      // Update location marker.
      const newPosition =
        updateCurrentPositionMarker(position);

      // Compare with the last point.
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

      // Recalculate contours only when route data changes,
      // not when the user zooms or pans.
      drawContourLines();

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
  drawContourLines();
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
   14. EXPORT MAP DATA
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
   15. IMPORT MAP DATA
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
        drawContourLines();
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
   16. INITIALISE
------------------------------------------ */

loadMapData();

console.log("The Invisible Map is ready!");
